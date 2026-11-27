import axios from "axios";

import type { NextApiRequest, NextApiResponse } from "next";

const lineApiHost = "api.line.me";
const lineImageHost = "api-data.line.me";
const richMenuEndpoints = [
  { method: "GET", path: /^\/v2\/bot\/(?:info|richmenu\/list)$/ },
  { method: "POST", path: /^\/v2\/bot\/richmenu(?:\/bulk\/(?:link|unlink)|\/alias)?$/ },
  { method: "POST", path: /^\/v2\/bot\/user\/all\/richmenu\/richmenu-[a-zA-Z0-9]+$/ },
  { method: "DELETE", path: /^\/v2\/bot\/user\/all\/richmenu$/ },
  { method: "DELETE", path: /^\/v2\/bot\/richmenu\/(?:richmenu-[a-zA-Z0-9]+|alias\/[a-z0-9_-]{1,32})$/ }
];
const imagePath = /^\/v2\/bot\/richmenu\/richmenu-[a-zA-Z0-9]+\/content$/;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  const { method } = req;
  const { target } = req.query;
  const [, host, path] = typeof target === "string"
    ? /^([^/]+)(\/[^\s]*)$/.exec(target) ?? []
    : [];
  const isImageRequest = host === lineImageHost && (method === "GET" || method === "POST")
    && imagePath.exec(path)?.[0] === path;
  const isApiRequest = host === lineApiHost && richMenuEndpoints.some(endpoint => (
    endpoint.method === method && endpoint.path.exec(path)?.[0] === path
  ));
  if (!(isImageRequest || isApiRequest) || target !== `${host}${path}`) {
    return res.status(403).end();
  }

  const headers = {
    "Content-Type": req.headers["content-type"],
    "Authorization": req.headers.authorization
  };

  const buffers = [];
  for await (const chunk of req) {
    buffers.push(chunk);
  }
  const body = Buffer.concat(buffers);

  const upstreamHost = isImageRequest ? lineImageHost : lineApiHost;
  const apiResult = await axios({
    method,
    url: `https://${upstreamHost}${path}`,
    headers,
    data: body,
    timeout: 3000,
    maxRedirects: 0,
    responseType: "arraybuffer",
    validateStatus: () => true
  }).catch(() => null);

  if (!apiResult || (apiResult.status >= 300 && apiResult.status < 400)) {
    return res.status(502).json({ message: "LINE API request failed" });
  }
  if (apiResult.data.length === 0) {
    return res.status(apiResult.status).end();
  }

  const contentType = String(apiResult.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  const isImageResponse = isImageRequest && method === "GET"
    && (contentType === "image/jpeg" || contentType === "image/png");
  if (contentType !== "application/json" && !isImageResponse) {
    return res.status(502).json({ message: "Unexpected LINE API response type" });
  }

  res.setHeader("Content-Type", contentType);
  return res.status(apiResult.status).send(apiResult.data);
}

export const config = { api: { bodyParser: false } };
