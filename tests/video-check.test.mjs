import assert from "node:assert/strict";
import test from "node:test";

import "./alias.mjs";

const vc = await import("@/lib/video-check");

// Um MP4 montado caixa por caixa, só com o que o leitor usa.

function concat(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function u16(value) {
  return new Uint8Array([(value >>> 8) & 255, value & 255]);
}

function u32(value) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0);
  return out;
}

function i32(value) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setInt32(0, value);
  return out;
}

function ascii(text) {
  return new Uint8Array([...text].map((char) => char.charCodeAt(0)));
}

function box(type, ...parts) {
  const body = concat(parts);
  return concat([u32(body.length + 8), ascii(type), body]);
}

/** A caixa com o tamanho de 64 bits (o `size` 1). */
function largeBox(type, body) {
  const size = body.length + 16;
  return concat([u32(1), ascii(type), u32(0), u32(size), body]);
}

const zeros = (length) => new Uint8Array(length);

function mvhd(timescale, duration) {
  return box("mvhd", zeros(4), zeros(8), u32(timescale), u32(duration), zeros(80));
}

function mdhd(timescale, duration) {
  return box("mdhd", zeros(4), zeros(8), u32(timescale), u32(duration), zeros(4));
}

function tkhd(width, height, rotated) {
  const one = 0x10000;
  const matrix = rotated ? [0, one, 0, -one, 0, 0, 0, 0, 0x40000000] : [one, 0, 0, 0, one, 0, 0, 0, 0x40000000];
  return box("tkhd", zeros(4), zeros(20), zeros(16), ...matrix.map(i32), u32(width * one), u32(height * one));
}

function trak({ handler = "vide", codec = "avc1", width = 640, height = 360, rotated = false, timescale = 30000, duration = 180000, pasp = null }) {
  // A entrada visual: os campos fixos e, depois deles, as caixas filhas (o avcC de mentira e o pasp, quando vem).
  const extra = [box("avcC", zeros(8)), ...(pasp ? [box("pasp", u32(pasp[0]), u32(pasp[1]))] : [])];
  const entry = box(codec, zeros(6), u16(1), zeros(16), u16(width), u16(height), zeros(50), ...extra);
  const stsd = box("stsd", zeros(4), u32(1), entry);
  return box(
    "trak",
    tkhd(width, height, rotated),
    box("mdia", mdhd(timescale, duration), box("hdlr", zeros(4), zeros(4), ascii(handler), zeros(12), new Uint8Array([0])), box("minf", box("stbl", stsd))),
  );
}

function mp4({ faststart = true, movie = [1000, 6000], tracks = [{}], mdatSize = 4000, large = false, first = "ftyp" } = {}) {
  const ftyp = box(first, ascii("isom"), u32(512), ascii("isomiso2avc1mp41"));
  const moov = box("moov", mvhd(...movie), ...tracks.map(trak));
  const mdat = large ? largeBox("mdat", zeros(mdatSize)) : box("mdat", zeros(mdatSize));
  return faststart ? concat([ftyp, box("free", zeros(8)), moov, mdat]) : concat([ftyp, mdat, moov]);
}

/** A leitura por faixa, como o `Blob.slice`, contando os bytes lidos. */
function reader(bytes) {
  const counter = { bytes: 0 };
  const read = async (start, end) => {
    counter.bytes += end - start;
    return bytes.slice(start, end);
  };
  return { read, counter };
}

async function infoOf(bytes) {
  return vc.readMp4Info(reader(bytes).read, bytes.length);
}

test("o H.264 com faststart passa, com a duração e a medida", async () => {
  const info = await infoOf(mp4());
  assert.equal(info.faststart, true);
  assert.deepEqual(info.video, { codec: "avc1", width: 640, height: 360, rotated: false, pixelRatio: 1, durationMs: 6000 });
  assert.equal(vc.videoInfoProblem(info), null);
  const meta = vc.videoMetaOf(info);
  assert.deepEqual(meta, { durationMs: 6000, width: 640, height: 360 });
  assert.deepEqual(vc.videoCustomMetadata(meta), { durationMs: "6000", width: "640", height: "360" });
  assert.equal(vc.videoMetaText(meta), "0:06 · 640x360");
  assert.equal(vc.videoMetaText({ durationMs: 125_400, width: 720, height: 1280 }), "2:05 · 720x1280");
});

test("lê só os cabeçalhos e o índice, sem os dados do vídeo", async () => {
  const bytes = mp4({ mdatSize: 200_000 });
  const { read, counter } = reader(bytes);
  await vc.readMp4Info(read, bytes.length);
  assert.ok(counter.bytes < 2_000, `leu ${counter.bytes} bytes`);
});

test("o índice depois dos dados: sem o faststart", async () => {
  const info = await infoOf(mp4({ faststart: false }));
  assert.equal(info.faststart, false);
  assert.equal(info.video?.codec, "avc1");
  assert.equal(vc.videoInfoProblem(info), 'O vídeo precisa do início rápido: exporte de novo com a opção "Web Optimized" ou "Fast Start" ligada.');
  // A caixa de dados com o tamanho de 64 bits também é pulada pelo cabeçalho.
  const large = await infoOf(mp4({ faststart: false, large: true }));
  assert.equal(large.faststart, false);
  assert.equal(large.video?.width, 640);
});

test("HEVC recusado com a frase, e outro codec também", async () => {
  const hevc = "Vídeo em HEVC (H.265) não vale: alguns Android não tocam. Exporte em H.264 e tente de novo.";
  assert.equal(vc.videoInfoProblem(await infoOf(mp4({ tracks: [{ codec: "hvc1" }] }))), hevc);
  assert.equal(vc.videoInfoProblem(await infoOf(mp4({ tracks: [{ codec: "hev1" }] }))), hevc);
  assert.equal(vc.videoInfoProblem(await infoOf(mp4({ tracks: [{ codec: "av01" }] }))), "O vídeo precisa estar em H.264. Exporte de novo nesse formato.");
  // As variantes do H.264 também ficam de fora, com a frase delas.
  for (const codec of ["avc2", "avc3", "avc4"]) {
    assert.equal(
      vc.videoInfoProblem(await infoOf(mp4({ tracks: [{ codec }] }))),
      "Este H.264 é de uma variante que nem todo aparelho toca. Exporte de novo em MP4 H.264 padrão.",
      codec,
    );
  }
  // O codec vem antes do faststart: a pessoa resolve os dois na mesma exportação.
  assert.equal(vc.videoInfoProblem(await infoOf(mp4({ faststart: false, tracks: [{ codec: "hvc1" }] }))), hevc);
});

test("até 720p, deitado ou de pé", async () => {
  assert.equal(vc.videoInfoProblem(await infoOf(mp4({ tracks: [{ width: 1280, height: 720 }] }))), null);
  assert.equal(vc.videoInfoProblem(await infoOf(mp4({ tracks: [{ width: 720, height: 1280 }] }))), null);
  assert.equal(vc.videoInfoProblem(await infoOf(mp4({ tracks: [{ width: 720, height: 900 }] }))), null);
  assert.equal(
    vc.videoInfoProblem(await infoOf(mp4({ tracks: [{ width: 1920, height: 1080 }] }))),
    "O vídeo tem 1920x1080. O limite é 720p (até 1280x720, ou 720x1280 de pé). Exporte numa resolução menor.",
  );
  assert.match(vc.videoInfoProblem(await infoOf(mp4({ tracks: [{ width: 1080, height: 1350 }] }))), /^O vídeo tem 1080x1350\./);
});

test("o vídeo gravado de pé: a medida na tela vira, também na frase da recusa", async () => {
  const info = await infoOf(mp4({ tracks: [{ width: 640, height: 360, rotated: true }] }));
  assert.equal(info.video?.rotated, true);
  assert.deepEqual(vc.videoMetaOf(info), { durationMs: 6000, width: 360, height: 640 });
  const tall = await infoOf(mp4({ tracks: [{ width: 1920, height: 1080, rotated: true }] }));
  assert.equal(
    vc.videoInfoProblem(tall),
    "O vídeo tem 1080x1920. O limite é 720p (até 1280x720, ou 720x1280 de pé). Exporte numa resolução menor.",
  );
});

test("o pixel não quadrado (pasp): a largura de tela no metadado, e o limite pela medida codificada", async () => {
  const wide = await infoOf(mp4({ tracks: [{ width: 640, height: 360, pasp: [4, 3] }] }));
  assert.equal(wide.video?.pixelRatio, 4 / 3);
  assert.deepEqual(vc.videoMetaOf(wide), { durationMs: 6000, width: 853, height: 360 });
  const turned = await infoOf(mp4({ tracks: [{ width: 640, height: 360, pasp: [4, 3], rotated: true }] }));
  assert.deepEqual(vc.videoMetaOf(turned), { durationMs: 6000, width: 360, height: 853 });
  // 1280x720 com o pixel 2:1 aparece com 2560 de largura, mas passa: o limite é da medida codificada.
  const anamorphic = await infoOf(mp4({ tracks: [{ width: 1280, height: 720, pasp: [2, 1] }] }));
  assert.equal(vc.videoInfoProblem(anamorphic), null);
  assert.deepEqual(vc.videoMetaOf(anamorphic), { durationMs: 6000, width: 2560, height: 720 });
  // O pasp quadrado, ou torto (zero), vale 1.
  assert.equal((await infoOf(mp4({ tracks: [{ pasp: [1, 1] }] }))).video?.pixelRatio, 1);
  assert.equal((await infoOf(mp4({ tracks: [{ pasp: [0, 1] }] }))).video?.pixelRatio, 1);
});

test("a duração da faixa quando o filme não traz, e o arquivo sem vídeo", async () => {
  const info = await infoOf(mp4({ movie: [1000, 0], tracks: [{ timescale: 30000, duration: 90000 }] }));
  assert.equal(info.durationMs, 3000);
  const audio = await infoOf(mp4({ tracks: [{ handler: "soun", codec: "mp4a" }] }));
  assert.equal(audio.video, null);
  assert.equal(vc.videoInfoProblem(audio), "O arquivo não tem imagem de vídeo. Escolha outro MP4.");
  // O áudio antes do vídeo: vale a primeira faixa de vídeo.
  const both = await infoOf(mp4({ tracks: [{ handler: "soun", codec: "mp4a" }, { codec: "avc1", width: 720, height: 720 }] }));
  assert.equal(both.video?.width, 720);
});

test("o que não é MP4 não passa da leitura", async () => {
  await assert.rejects(infoOf(mp4({ first: "wide" })), vc.VideoCheckError);
  await assert.rejects(infoOf(new Uint8Array([0, 0, 0, 8])), vc.VideoCheckError);
  const cut = mp4().slice(0, 60);
  await assert.rejects(infoOf(cut), vc.VideoCheckError);
});

test("textos sem travessão nem meia-risca", () => {
  assert.doesNotMatch(vc.VIDEO_RULES_TEXT, /[–—]/);
  assert.equal(vc.VIDEO_MAX_BYTES, 20 * 1024 * 1024);
});
