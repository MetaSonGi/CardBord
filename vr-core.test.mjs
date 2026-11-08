// 실행: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { orientationToQuat, quatMul, axisAngle, applyDrag, GazeFuse, sanitizeSettings, validateScenes, SCENES } from './vr-core.js';

const near = (a, b, eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < eps) || a.every((v, i) => Math.abs(v + b[i]) < eps);
// 쿼터니언으로 벡터 회전
function rotate(q, v) {
  const p = quatMul(quatMul(q, [...v, 0]), [-q[0], -q[1], -q[2], q[3]]);
  return p.slice(0, 3);
}

test('폰을 세워 정면(beta=90)을 보면 카메라는 회전 없음', () => {
  assert.ok(near(orientationToQuat(0, 90, 0, 0), [0, 0, 0, 1]));
});

test('폰을 평평하게 눕히면(beta=0) 카메라는 아래를 봄', () => {
  const dir = rotate(orientationToQuat(0, 0, 0, 0), [0, 0, -1]);
  assert.ok(near(dir, [0, -1, 0]), dir.join());
});

test('alpha 90°(왼쪽으로 돌기)면 카메라가 왼쪽(-x)을 봄', () => {
  const dir = rotate(orientationToQuat(90, 90, 0, 0), [0, 0, -1]);
  assert.ok(near(dir, [-1, 0, 0], 1e-6), dir.join());
});

test('가로 화면(90°) 보정은 시선 방향을 바꾸지 않고 화면만 돌림', () => {
  const dir = rotate(orientationToQuat(0, 90, 0, 90), [0, 0, -1]);
  assert.ok(near(dir, [0, 0, -1]), dir.join());
  const up = rotate(orientationToQuat(0, 90, 0, 90), [0, 1, 0]);
  assert.ok(near(up, [-1, 0, 0]) || near(up, [1, 0, 0]), up.join());
});

test('쿼터니언은 항상 단위 길이', () => {
  for (const [a, b, g, s] of [[10, 20, 30, 0], [200, -45, 80, 90], [359, 179, -89, -90]]) {
    const q = orientationToQuat(a, b, g, s);
    assert.ok(Math.abs(Math.hypot(...q) - 1) < 1e-9);
  }
  assert.ok(Math.abs(Math.hypot(...axisAngle([0, 1, 0], 1.2)) - 1) < 1e-9);
});

test('드래그: 수직 회전은 ±85°로 제한', () => {
  let v = { yaw: 0, pitch: 0 };
  v = applyDrag(v, 0, -10000);
  assert.ok(Math.abs(v.pitch - 85 * Math.PI / 180) < 1e-9);
  v = applyDrag({ yaw: 0, pitch: 0 }, 40, 0);
  assert.ok(v.yaw < 0);
});

test('응시 선택: 1.5초 후 한 번만 실행, 시선을 떼면 초기화', () => {
  const f = new GazeFuse(1.5);
  assert.equal(f.update('a', 1.0).fire, null);
  assert.ok(Math.abs(f.update('a', 0).progress - 2 / 3) < 1e-9);
  assert.equal(f.update('a', 0.6).fire, 'a');
  assert.equal(f.update('a', 5).fire, null);          // 계속 봐도 재실행 없음
  assert.equal(f.update(null, 0.1).progress, 0);      // 시선 이탈
  assert.equal(f.update('a', 0.5).fire, null);        // 처음부터 다시
  assert.equal(f.update('b', 2).fire, 'b');           // 다른 대상
});

test('설정 정리: 범위 밖·손상 값 처리', () => {
  assert.deepEqual(sanitizeSettings({ ipd: 1, fov: 10, fuse: 'x' }), { ipd: 0.08, fov: 60, fuse: 1.5 });
  assert.deepEqual(sanitizeSettings(null), { ipd: 0.064, fov: 80, fuse: 1.5 });
});

test('장면 데이터 무결성과 검사기', () => {
  assert.deepEqual(validateScenes(SCENES), []);
  assert.ok(validateScenes([{ id: 'a', title: 'A', hotspots: [{ type: 'scene', pos: [0, 0, 0], to: 'zzz' }] }]).length);
  assert.ok(validateScenes([{ id: 'a', title: 'A', hotspots: [{ type: 'info', pos: [0, 0] }] }]).length >= 2);
});
