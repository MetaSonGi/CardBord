// VR 체험 핵심 로직 (three.js·DOM 없음) — 브라우저와 Node 테스트에서 함께 사용

const DEG = Math.PI / 180;

/** 쿼터니언 [x, y, z, w] 곱 a*b */
export function quatMul(a, b) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [
    ax * bw + aw * bx + ay * bz - az * by,
    ay * bw + aw * by + az * bx - ax * bz,
    az * bw + aw * bz + ax * by - ay * bx,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function axisAngle(axis, angle) {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

/** 오일러(YXZ 순서, 라디안) → 쿼터니언 */
export function eulerYXZ(x, y, z) {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 - s1 * s2 * c3,
    c1 * c2 * c3 + s1 * s2 * s3,
  ];
}

/**
 * 기기 방향(deviceorientation 이벤트의 alpha·beta·gamma, 도)과 화면 회전각(도)으로
 * 카메라 쿼터니언을 계산합니다. 폰을 세워 정면을 볼 때(beta=90) 단위 쿼터니언이 됩니다.
 */
export function orientationToQuat(alpha = 0, beta = 0, gamma = 0, screenAngle = 0) {
  let q = eulerYXZ(beta * DEG, alpha * DEG, -gamma * DEG);
  q = quatMul(q, [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]);            // 카메라가 기기 뒷면 대신 화면 바깥을 보도록 X축 -90°
  q = quatMul(q, axisAngle([0, 0, 1], -screenAngle * DEG));        // 가로·세로 화면 보정
  return q;
}

/** 드래그 둘러보기: 수평은 자유 회전, 수직은 ±85°로 제한 */
export function applyDrag(view, dx, dy, sensitivity = 0.25) {
  const yaw = view.yaw - dx * sensitivity * DEG;
  const pitch = Math.max(-85 * DEG, Math.min(85 * DEG, view.pitch - dy * sensitivity * DEG));
  return { yaw, pitch };
}

/**
 * 응시(gaze) 선택: 같은 대상을 duration초 동안 바라보면 한 번 실행.
 * 대상에서 시선을 떼면 초기화되고, 다시 바라봐야 다시 실행됩니다.
 */
export class GazeFuse {
  constructor(duration = 1.5) {
    this.duration = duration;
    this.target = null;
    this.elapsed = 0;
    this.fired = false;
  }

  update(targetId, dt) {
    if (targetId !== this.target) {
      this.target = targetId;
      this.elapsed = 0;
      this.fired = false;
    }
    if (targetId == null) return { progress: 0, fire: null };
    if (this.fired) return { progress: 1, fire: null };
    this.elapsed += Math.max(0, dt);
    if (this.elapsed >= this.duration) {
      this.fired = true;
      return { progress: 1, fire: targetId };
    }
    return { progress: this.elapsed / this.duration, fire: null };
  }
}

export const DEFAULT_SETTINGS = { ipd: 0.064, fov: 80, fuse: 1.5 };

/** 저장된 설정을 안전한 범위로 맞춥니다 (손상된 값은 기본값) */
export function sanitizeSettings(s) {
  const clamp = (v, lo, hi, def) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : def);
  const src = s && typeof s === 'object' ? s : {};
  return {
    ipd: clamp(src.ipd, 0.05, 0.08, DEFAULT_SETTINGS.ipd),
    fov: clamp(src.fov, 60, 100, DEFAULT_SETTINGS.fov),
    fuse: clamp(src.fuse, 0.5, 4, DEFAULT_SETTINGS.fuse),
  };
}

/** 장면 정의 검사: id 중복·필수 값·핫스팟 종류 */
export function validateScenes(scenes) {
  const errors = [];
  const ids = new Set();
  for (const sc of scenes) {
    if (!sc.id || ids.has(sc.id)) errors.push(`장면 id 오류: ${sc.id}`);
    ids.add(sc.id);
    if (!sc.title) errors.push(`${sc.id}: 제목 없음`);
    for (const h of sc.hotspots || []) {
      if (!['move', 'info', 'scene'].includes(h.type)) errors.push(`${sc.id}: 알 수 없는 핫스팟 ${h.type}`);
      if (!Array.isArray(h.pos) || h.pos.length !== 3 || h.pos.some(v => !Number.isFinite(v))) errors.push(`${sc.id}: 핫스팟 위치 오류`);
      if (h.type === 'info' && !h.text) errors.push(`${sc.id}: info 핫스팟에 text 없음`);
    }
  }
  for (const sc of scenes) for (const h of sc.hotspots || []) {
    if (h.type === 'scene' && !ids.has(h.to)) errors.push(`${sc.id}: 없는 장면으로 이동 ${h.to}`);
  }
  return errors;
}

/** 장면 데이터: 도형만으로 그리는 3개 체험. pos는 [x, y, z] 미터 */
export const SCENES = [
  {
    id: 'space', title: '우주 전망대', sky: 0x02030a,
    hotspots: [
      { type: 'info', pos: [0, 1.6, -6], text: '토성형 행성: 고리는 작은 얼음·암석 조각의 띠입니다' },
      { type: 'move', pos: [4, 0.2, -3] },
      { type: 'scene', pos: [-4, 1.4, -4], to: 'forest', text: '숲으로 이동' },
    ],
  },
  {
    id: 'forest', title: '숲 속 산책', sky: 0x9fd3f5,
    hotspots: [
      { type: 'move', pos: [0, 0.2, -6] },
      { type: 'move', pos: [-5, 0.2, -9] },
      { type: 'info', pos: [3, 1.5, -5], text: '나무 사이를 바라보며 이동 점을 1.5초 응시하면 걸어갑니다' },
      { type: 'scene', pos: [5, 1.4, -2], to: 'factory', text: '공장 견학' },
    ],
  },
  {
    id: 'factory', title: '스마트 팩토리 견학', sky: 0x20242b,
    hotspots: [
      { type: 'info', pos: [0, 1.8, -4], text: '컨베이어: 부품이 공정 순서대로 이동합니다' },
      { type: 'info', pos: [-3, 1.8, -6], text: '로봇팔: 부품을 집어 다음 공정으로 옮깁니다' },
      { type: 'move', pos: [2, 0.2, -7] },
      { type: 'scene', pos: [4, 1.4, -3], to: 'space', text: '우주 전망대로' },
    ],
  },
];
