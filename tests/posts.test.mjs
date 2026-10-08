import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";
import { Timestamp } from "./fakes/firestore.mjs";

const posts = await import("@/lib/posts");

test("o post lido: tipo, mídia com o vídeo e as contagens", () => {
  const post = posts.parsePost("p1", {
    artistId: "nettobrito",
    kind: "video",
    text: "Clipe",
    media: {
      photo: { url: "u1", path: "posts/p1/photo-1-1080.webp", width: 1080, height: 608 },
      thumb: { url: "u2", path: "posts/p1/thumb-1-480.webp", width: 480, height: 270 },
      video: { url: "u3", path: "posts/p1/video-1.mp4", size: 1234 },
    },
    status: "published",
    publishedAt: Timestamp.fromMillis(1000),
    likeCount: 3,
    commentCount: -1,
  });
  assert.equal(post.kind, "video");
  assert.equal(post.media.video.size, 1234);
  assert.equal(post.commentCount, 0);
  assert.equal(posts.parsePost("p2", { kind: "outro" }).kind, "text");
  assert.equal(posts.parsePost("p3", { media: null }).media, null);
  assert.equal(posts.postDeleteBlocked(post), posts.WAS_PUBLISHED_POST_TEXT);
  assert.equal(posts.postDeleteBlocked({ publishedAt: null }), null);
  assert.equal(posts.needsMedia("photo"), true);
  assert.equal(posts.needsMedia("event"), false);
});

test("o texto limpo como o servidor: obrigatório no texto e no show", () => {
  const base = { artistId: "nenho", kind: "text", text: "  Olá\r\n\r\n\r\nfãs  ", eventId: "" };
  assert.deepEqual(posts.validatePost(base), { errors: {}, text: "Olá\n\nfãs" });
  assert.equal(posts.validatePost({ ...base, text: "  " }).errors.text, "Escreva o texto do post.");
  assert.deepEqual(posts.validatePost({ ...base, kind: "photo", text: "" }), { errors: {}, text: "" });
  assert.equal(posts.validatePost({ ...base, kind: "event" }).errors.eventId, "Escolha o show.");
  assert.equal(posts.validatePost({ ...base, text: "x".repeat(2001) }).errors.text, "Até 2.000 caracteres.");
  assert.equal(posts.validatePost({ ...base, artistId: "" }).errors.artistId, "Escolha a central.");
  assert.equal(posts.textCounter("  abc  "), "3 de 2.000");
});

test("o vídeo: MP4 até 50 MB, MOV recusado com a frase", () => {
  assert.equal(posts.videoFileProblem({ type: "video/mp4", name: "a.mp4", size: 1000 }), null);
  assert.equal(posts.videoFileProblem({ type: "video/quicktime", name: "a.mov", size: 1000 }), "Vídeo MOV não vale. Exporte em MP4 e tente de novo.");
  assert.equal(posts.videoFileProblem({ type: "video/webm", name: "a.webm", size: 1000 }), "O vídeo precisa ser MP4.");
  assert.equal(posts.videoFileProblem({ type: "video/mp4", name: "a.mp4", size: 51 * 1024 * 1024 }), "O vídeo passa de 50 MB. Envie uma versão menor.");
  assert.equal(posts.fileSizeText(177_442), "173 KB");
  assert.equal(posts.fileSizeText(12.4 * 1024 * 1024), "12,4 MB");
  assert.match(posts.uncertainCreateText("o post"), /^Não deu para confirmar se o post foi criado\./);
  assert.equal(posts.postExcerpt("  Saiu   o clipe  "), "Saiu o clipe");
});
