import assert from "node:assert/strict";
import test from "node:test";
import { createGateway } from "@ai-sdk/gateway";
import { GoogleGenAI } from "@google/genai";
import { neon } from "@neondatabase/serverless";
import {
  experimental_getVideoStatus,
  experimental_startVideo,
  generateImage,
  generateText,
} from "ai";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";

test("Sharp encodes and decodes a synthetic image with its native runtime", async () => {
  const png = await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 4,
      background: { r: 31, g: 143, b: 122, alpha: 1 },
    },
  }).png().toBuffer();

  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 2);
  assert.equal(info.height, 2);
  assert.equal(info.channels, 4);
  assert.deepEqual(data, Buffer.from(Array(4).fill([31, 143, 122, 255]).flat()));
});

test("paired React packages render escaped server markup", () => {
  const markup = renderToStaticMarkup(createElement("span", null, "image <ready>"));
  assert.equal(markup, "<span>image &lt;ready&gt;</span>");
});

test("installed SDKs expose the image, video and SQL interfaces used by the app", (t) => {
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("Dependency compatibility checks must not make network requests");
  });

  for (const api of [generateImage, generateText, experimental_startVideo, experimental_getVideoStatus]) {
    assert.equal(typeof api, "function");
  }

  const gateway = createGateway({ apiKey: "synthetic-test-key" });
  assert.equal(typeof gateway.image, "function");
  assert.equal(typeof gateway.video, "function");

  const google = new GoogleGenAI({ apiKey: "synthetic-test-key" });
  assert.equal(typeof google.models.generateContent, "function");
  assert.equal(typeof google.models.generateImages, "function");
  assert.equal(typeof google.models.generateVideos, "function");
  assert.equal(typeof google.operations.getVideosOperation, "function");
  assert.equal(typeof neon, "function");
});
