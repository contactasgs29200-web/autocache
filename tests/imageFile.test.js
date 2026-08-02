import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataURLToBlob, withImageExt } from '../src/imageFile.js';

// 1×1 JPEG et PNG minimaux, en data URL.
const JPEG_1PX = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('le nom d\'export perd l\'extension d\'origine (sinon iOS produit .png.jpeg)', () => {
  assert.equal(withImageExt('autocache_IMG_5432.png', 'image/jpeg'), 'autocache_IMG_5432.jpg');
  assert.equal(withImageExt('showroom_photo.jpeg', 'image/jpeg'), 'showroom_photo.jpg');
  assert.equal(withImageExt('autocache_photo.HEIC', 'image/jpeg'), 'autocache_photo.jpg');
});

test('un export PNG garde l\'extension png', () => {
  assert.equal(withImageExt('autocache_IMG_5432.jpg', 'image/png'), 'autocache_IMG_5432.png');
});

test('seule la dernière extension est remplacée', () => {
  assert.equal(withImageExt('photo.v2.png', 'image/jpeg'), 'photo.v2.jpg');
  assert.equal(withImageExt('autocache_rogné_ma photo.png', 'image/jpeg'), 'autocache_rogné_ma photo.jpg');
});

test('un nom sans extension reçoit simplement la sienne', () => {
  assert.equal(withImageExt('sans_extension', 'image/jpeg'), 'sans_extension.jpg');
});

test('un nom vide ou absent ne produit jamais un fichier sans nom', () => {
  assert.equal(withImageExt('', 'image/jpeg'), 'photo.jpg');
  assert.equal(withImageExt(null, 'image/jpeg'), 'photo.jpg');
  assert.equal(withImageExt(undefined, 'image/jpeg'), 'photo.jpg');
});

test('la data URL devient un Blob du bon type', () => {
  const jpg = dataURLToBlob(JPEG_1PX);
  assert.equal(jpg.type, 'image/jpeg');
  assert.ok(jpg.size > 0, 'le blob ne doit pas être vide');
  const png = dataURLToBlob(PNG_1PX);
  assert.equal(png.type, 'image/png');
  assert.ok(png.size > 0);
});

test('les octets du Blob sont ceux de la data URL, sans corruption', async () => {
  const b64 = PNG_1PX.split(',')[1];
  const attendu = Buffer.from(b64, 'base64');
  const obtenu = Buffer.from(await dataURLToBlob(PNG_1PX).arrayBuffer());
  assert.deepEqual(obtenu, attendu);
  // Signature PNG : le fichier doit rester lisible par un visualiseur.
  assert.deepEqual([...obtenu.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});

test('une data URL sans en-tête de type retombe sur le JPEG', () => {
  assert.equal(dataURLToBlob('data:;base64,' + PNG_1PX.split(',')[1]).type, 'image/jpeg');
});

test('une chaîne qui n\'est pas une data URL est rejetée', () => {
  assert.throws(() => dataURLToBlob('pas-une-data-url'), /data URL invalide/);
});
