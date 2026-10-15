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

function trak({ handler = "vide", codec = "avc1", width = 640, height = 360, rotated = false, timescale = 30000, duration = 180000, pasp = null, profile = 100 }) {
  // A entrada visual: os campos fixos e, depois deles, as caixas filhas (o avcC com o perfil, quando vem, e o pasp).
  const extra = [
    ...(profile === null ? [] : [box("avcC", new Uint8Array([1, profile, 0, 31, 0xff, 0xe1, 0, 0]))]),
    ...(pasp ? [box("pasp", u32(pasp[0]), u32(pasp[1]))] : []),
  ];
  const entry = box(codec, zeros(6), u16(1), zeros(16), u16(width), u16(height), zeros(50), ...extra);
  const stsd = box("stsd", zeros(4), u32(1), entry);
  return box(
    "trak",
    tkhd(width, height, rotated),
    box("mdia", mdhd(timescale, duration), box("hdlr", zeros(4), zeros(4), ascii(handler), zeros(12), new Uint8Array([0])), box("minf", box("stbl", stsd))),
  );
}

/** O `mvex` de um MP4 fragmentado, com o `mehd` (versão 0 ou 1) quando vem a duração inteira. */
function mvex(fragmentDuration = null, version = 0) {
  const trex = box("trex", zeros(4), u32(1), zeros(16));
  if (fragmentDuration === null) return box("mvex", trex);
  const duration = version === 1 ? concat([u32(Math.floor(fragmentDuration / 2 ** 32)), u32(fragmentDuration)]) : u32(fragmentDuration);
  return box("mvex", box("mehd", new Uint8Array([version, 0, 0, 0]), duration), trex);
}

function mp4({ faststart = true, movie = [1000, 6000], tracks = [{}], mdatSize = 4000, large = false, first = "ftyp", moovExtra = [] } = {}) {
  const ftyp = box(first, ascii("isom"), u32(512), ascii("isomiso2avc1mp41"));
  const moov = box("moov", mvhd(...movie), ...tracks.map(trak), ...moovExtra);
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
  assert.deepEqual(info.video, { codec: "avc1", width: 640, height: 360, rotated: false, pixelRatio: 1, profile: 100, durationMs: 6000 });
  assert.equal(vc.videoInfoProblem(info), null);
  const meta = vc.videoMetaOf(info);
  assert.deepEqual(meta, { durationMs: 6000, width: 640, height: 360 });
  assert.deepEqual(vc.videoCustomMetadata(meta), { durationMs: "6000", width: "640", height: "360" });
  assert.equal(vc.videoMetaText(meta), "0:06 · 640x360");
  assert.equal(vc.videoMetaText({ durationMs: 125_400, width: 720, height: 1280 }), "2:05 · 720x1280");
});

test("até 1 minuto, com meio segundo de folga: 60,499 s passa, 60,5 s fica de fora com a duração na frase", async () => {
  const problemOf = async (movie, track = {}) => vc.videoInfoProblem(await infoOf(mp4({ movie, tracks: [track] })));
  for (const movie of [
    [1000, 59_000],
    [1000, 60_000],
    // Os "1:00" de verdade: o enchimento do AAC, o corte sem recodificar, 1800 quadros a 29,97 fps e os B-frames.
    [1000, 60_024],
    [1000, 60_020],
    [600, 36_036],
    [1000, 60_067],
    [600, 36_000],
    [600, 36_299],
    [1000, 60_499],
  ]) {
    assert.equal(await problemOf(movie), null, String(movie));
  }
  const refused = "O vídeo tem 1 min 1 s. O limite é de 1 minuto: corte e exporte de novo.";
  assert.equal(await problemOf([1000, 60_500]), refused);
  assert.equal(await problemOf([600, 36_300]), refused);
  assert.equal(await problemOf([1000, 60_600]), refused);
  assert.equal(await problemOf([1000, 61_000]), refused);
  assert.equal(await problemOf([1000, 100_000]), "O vídeo tem 1 min 40 s. O limite é de 1 minuto: corte e exporte de novo.");
  // Sem a duração no mvhd, vale a da faixa (mdhd).
  assert.equal(await problemOf([1000, 0], { timescale: 600, duration: 36_000 }), null);
  assert.equal(await problemOf([1000, 0], { timescale: 600, duration: 36_300 }), refused);

  // O arredondamento duplo (ao milissegundo na leitura, ao segundo no limite): 60,4995 s fica de fora.
  assert.equal(await problemOf([2000, 120_998]), null);
  assert.equal(await problemOf([2000, 120_999]), refused);
  // Não é só de 2000 para cima: 60560/1001 é 60,4995 s e também fica de fora.
  assert.equal(await problemOf([1001, 60_559]), null);
  assert.equal(await problemOf([1001, 60_560]), refused);

  // A duração "desconhecida" (todos os bits ligados) não vira número, no filme e na faixa.
  assert.equal(
    await problemOf([1000, 0xffffffff], { timescale: 1000, duration: 0xffffffff }),
    "Não deu para ler a duração do vídeo. Exporte de novo em MP4 (H.264).",
  );

  assert.equal(vc.durationText(45_000), "45 s");
  assert.equal(vc.durationText(60_400), "1 min");
  assert.equal(vc.durationText(60_500), "1 min 1 s");
  assert.equal(vc.durationText(120_000), "2 min");
  assert.equal(vc.VIDEO_MAX_SECONDS, 60);
  assert.match(vc.VIDEO_RULES_TEXT, /de até 1 minuto/);
});

test("todo MP4 fragmentado é recusado, com o mehd ou sem ele", async () => {
  const fragmented = (fragmentDuration = null, version = 0, movie = [1000, 2000]) =>
    mp4({ movie, tracks: [{ timescale: 1000, duration: 2000 }], moovExtra: [mvex(fragmentDuration, version)] });
  const refused = "Este MP4 está fragmentado. Exporte de novo em MP4 comum, sem fragmentar.";

  // Com o mehd (MP4Box, Bento4) e sem ele (o -movflags frag_keyframe do ffmpeg,
  // que no clipe mais curto que um GOP deixa o filme inteiro no moov, sem moof);
  // zerado, com todos os bits ligados e acima de 2^53 também.
  for (const [fragmentDuration, version] of [
    [100_000, 0],
    [100_000, 1],
    [59_000, 0],
    [null, 0],
    [0, 0],
    [0xffffffff, 0],
    [2 ** 53, 1],
  ]) {
    const info = await infoOf(fragmented(fragmentDuration, version));
    assert.equal(info.fragmented, true, String(fragmentDuration));
    // A duração do fragmentado não é lida: o mvhd cobriria só o primeiro fragmento (2 s).
    assert.equal(info.durationMs, null, String(fragmentDuration));
    assert.equal(vc.videoInfoProblem(info), refused, String(fragmentDuration));
    assert.equal(vc.videoMetaOf(info), null, String(fragmentDuration));
  }
  // A frase do fragmentado vem antes da duração e do codec: a pessoa exporta de novo uma vez.
  const long = mp4({ movie: [1000, 100_000], tracks: [{ codec: "hvc1" }], moovExtra: [mvex(100_000)] });
  assert.equal(vc.videoInfoProblem(await infoOf(long)), refused);
  // Sem o mvex, o mesmo arquivo continua lido pelo mvhd.
  const plain = await infoOf(mp4({ movie: [1000, 2000] }));
  assert.equal(plain.fragmented, false);
  assert.equal(plain.durationMs, 2000);
});

test("a duração vem logo depois da imagem, antes do codec, da resolução e do faststart", async () => {
  const long = [1000, 100_000];
  for (const options of [
    { movie: long, tracks: [{ width: 1920, height: 1080 }] },
    { movie: long, tracks: [{ codec: "hvc1" }] },
    { movie: long, tracks: [{ profile: 110 }] },
    { movie: long, faststart: false },
  ]) {
    assert.equal(
      vc.videoInfoProblem(await infoOf(mp4(options))),
      "O vídeo tem 1 min 40 s. O limite é de 1 minuto: corte e exporte de novo.",
      JSON.stringify(options),
    );
  }
  // Sem imagem de vídeo, essa frase vem antes.
  assert.match(vc.videoInfoProblem(await infoOf(mp4({ movie: long, tracks: [{ handler: "soun", codec: "mp4a" }] }))), /imagem de vídeo/);
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
  // O pasp quadrado, torto (zero) ou fora de 1/4 a 4 vale 1.
  assert.equal((await infoOf(mp4({ tracks: [{ pasp: [1, 1] }] }))).video?.pixelRatio, 1);
  assert.equal((await infoOf(mp4({ tracks: [{ pasp: [0, 1] }] }))).video?.pixelRatio, 1);
  assert.equal((await infoOf(mp4({ tracks: [{ pasp: [5, 1] }] }))).video?.pixelRatio, 1);
  assert.equal((await infoOf(mp4({ tracks: [{ pasp: [1, 5] }] }))).video?.pixelRatio, 1);
  assert.equal((await infoOf(mp4({ tracks: [{ pasp: [4, 1] }] }))).video?.pixelRatio, 4);
  assert.equal((await infoOf(mp4({ tracks: [{ pasp: [1, 4] }] }))).video?.pixelRatio, 1 / 4);
  // Os lados do metadado são inteiros, de 1 em diante.
  assert.deepEqual(vc.displaySize({ width: 1, height: 1, rotated: false, pixelRatio: 1 / 4 }), { width: 1, height: 1 });
  // A recusa diz a medida em que o limite vale: a codificada, sem o pasp.
  const wideHd = await infoOf(mp4({ tracks: [{ width: 1440, height: 1080, pasp: [4, 3] }] }));
  assert.match(vc.videoInfoProblem(wideHd), /^O vídeo tem 1440x1080\./);
});

test("o perfil do H.264: só Baseline, Main e High", async () => {
  for (const profile of [66, 77, 100]) assert.equal(vc.videoInfoProblem(await infoOf(mp4({ tracks: [{ profile }] }))), null, String(profile));
  const refused =
    "O vídeo usa um perfil do H.264 que muitos aparelhos não tocam (como o High 10 ou o 4:2:2). Exporte em H.264 de 8 bits, 4:2:0, perfil High, Main ou Baseline.";
  for (const profile of [110, 122, 244, 88]) assert.equal(vc.videoInfoProblem(await infoOf(mp4({ tracks: [{ profile }] }))), refused, String(profile));
  // Sem o avcC, o perfil não dá para ler: também fica de fora.
  assert.equal(vc.videoInfoProblem(await infoOf(mp4({ tracks: [{ profile: null }] }))), refused);
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

test("textos sem travessão nem meia-risca, também as frases de cada recusa", async () => {
  const DASHES = /[–—]/;
  assert.doesNotMatch(vc.VIDEO_RULES_TEXT, DASHES);
  assert.equal(vc.VIDEO_MAX_BYTES, 20 * 1024 * 1024);
  // Cada recusa com a frase dela.
  const cases = [
    [mp4({ tracks: [{ codec: "hvc1" }] }), /HEVC/],
    [mp4({ tracks: [{ codec: "avc3" }] }), /variante/],
    [mp4({ tracks: [{ codec: "av01" }] }), /precisa estar em H\.264/],
    [mp4({ tracks: [{ profile: 110 }] }), /perfil/],
    [mp4({ tracks: [{ width: 1920, height: 1080 }] }), /720p/],
    [mp4({ faststart: false }), /início rápido/],
    [mp4({ movie: [1000, 0], tracks: [{ duration: 0 }] }), /ler a duração/],
    [mp4({ tracks: [{ handler: "soun", codec: "mp4a" }] }), /imagem de vídeo/],
    [mp4({ movie: [1000, 100_000] }), /limite é de 1 minuto/],
    // A resolução que não dá para ler (sem medida no tkhd nem na entrada).
    [mp4({ tracks: [{ width: 0, height: 0 }] }), /ler a resolução/],
    [mp4({ moovExtra: [mvex()] }), /fragmentado/],
  ];
  for (const [bytes, phrase] of cases) {
    const problem = vc.videoInfoProblem(await infoOf(bytes));
    assert.match(problem, phrase);
    assert.doesNotMatch(problem, DASHES, problem);
  }
  const unreadable = await infoOf(mp4({ first: "wide" })).catch((error) => error.message);
  assert.doesNotMatch(unreadable, DASHES);
  // A frase da duração, a do fragmentado e a regra da tela também não levam hífen.
  assert.doesNotMatch(vc.videoInfoProblem(await infoOf(mp4({ movie: [1000, 100_000] }))), /-/);
  assert.doesNotMatch(vc.videoInfoProblem(await infoOf(mp4({ moovExtra: [mvex()] }))), /-/);
  assert.doesNotMatch(vc.VIDEO_RULES_TEXT, /-/);
});
