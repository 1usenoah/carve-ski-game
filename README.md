# CARVE RUSH 2.0 — 3D 알파인 스키 (WebGL)

`https://1usenoah.github.io/carve-ski-game/` 에서 바로 플레이할 수 있는 **Three.js 기반 3D 스키 레이싱 게임**입니다.
v1 프로토타입(단일 파일)을 **Vite + Three.js 모듈 프로젝트**로 전면 재제작했습니다.

![Race](https://img.shields.io/badge/mode-RACE-5ef0d8) ![Park](https://img.shields.io/badge/mode-PARK-ff5fa2) ![Vite](https://img.shields.io/badge/build-Vite%205-646cff) ![three](https://img.shields.io/badge/three.js-r169-000000)

## 플레이 방법

| 입력 | 동작 |
| --- | --- |
| `←` `→` (A / D) | 카빙 — 에지가 점진적으로 물리며 호를 그립니다 |
| `↑` (W) | 턱(tuck) — 낮게 엎드려 가속 |
| `↓` (S) | 브레이크 |
| `Space` | 점프 |
| `S` / `O` | 상점 |
| `Esc` | 일시정지 |
| `M` | 음소거 |

모바일에서는 화면 하단 터치 패드(◀ ▶ / 브레이크 / AIR / 턱)로 조작합니다.

### 모드

* **RACE** — 16개 게이트, 실시간 타이머, Gold/Silver/Bronze 메달, 최고 기록과 **고스트 리플레이**.
  게이트를 통과할 때 라인 정확도(`PERFECT LINE` / `CLEAN LINE` / `TIGHT CARVE` / `WIDE LINE`)를 판정하고,
  `MISSED GATE` 는 +2초 페널티입니다.
* **PARK** — 게이트 없이 킥커 3개와 레일 2개에서 에어타임·스핀·그라인드를 쌓는 프리 라이드.

### 상점 (테스트 결제)

스킨 4종(Classic / Neon Cyber / Crimson Pro / Golden Legend)과 맵 3종(Larchwood / Glacier / Midnight)을
**테스트 결제**로 잠금 해제합니다. 실제 금액은 청구되지 않으며 보유 상태는 `localStorage`(`carve.store.v2`)에 저장됩니다.
실서비스 연동 지점은 `src/services/store.js` 의 `purchase()` 하나이며, 서버 결제 확인 콜백에서 `grant()` 를 호출하도록 교체하면
게임 코드는 그대로 유지됩니다. 리더보드/고스트도 `src/services/leaderboard.js` 의 동일한 경계로 분리되어 있습니다.

## v2에서 새로 만든 것

**게이트 공략 가이드**
* 게이트에서 다음 게이트로 이어지는 **발광 점선 레이싱 라인**(커스텀 셰이더, 흐르는 대시 + 펄스).
* 각 게이트 폴 아래 **타겟 존 마커**(폴 링 + 게이트 라인 점선 + 중앙 셰브런)와 통과 시 **플래시 링 + 스파크 버스트**.
* 통과 순간 라인 정확도 판정 토스트.

**설원 / 알프스 환경**
* 70k 버텍스 설면에 **코듀로이 노멀맵 + 압설 알베도 + 거칠기맵**, 오목한 곳의 푸른 그림자 톤(버텍스 컬러).
* 3겹 원경 산맥(암석/설선/대기 원근 + 태양 방향 셰이딩), 전나무 3,000그루(인스턴싱), 주황 B-net과 기둥, 스타트/피니시 아치(배너 텍스처).
* 커스텀 스카이 셰이더(그라디언트 + 태양 + 권운 + 야간 별), PMREM 환경광, 안개.

**관절 스키어**
* 헬멧·고글·재킷·장갑·폴·부츠·카빙 스키까지 갖춘 계층 모델. **2-bone IK** 로 부츠는 스키에 붙은 채 무릎만 꺾입니다.
* 에지 각도에 따른 **몸통/무릎 앙귤레이션**, 턱 자세, 공중 스핀·그랩, 착지 스쿼시.
* 카빙 시 스키 테일에서 **눈보라 스프레이**(파티클 풀 2종), 바닥에 **두 줄 스키 자국**(동적 리본).

**카빙 물리 / 카메라 / 사운드**
* 점진적 에지 → `ω = g·tan(edge)/v` 카빙, 경사·항력·에지 스크럽, 점프/킥커 런치, 레일 그라인드.
* 추적 카메라의 **롤 기울기 + 속도 연동 FOV + 착지 셰이크 + 지형 클램프**.
* **Web Audio 절차적 사운드**(오디오 파일 없음): 속도 연동 바람, 카빙 스크레이프, 게이트 차임, 카운트다운, 착지, 구매음 + 음소거.

## 프로젝트 구조

```
index.html            ← vite build 산출물 (GitHub Pages 가 그대로 서빙)
assets/               ← 빌드된 JS 번들
app/                  ← 편집 가능한 소스 루트 (vite root)
  index.html
  src/
    main.js               부트스트랩 · 상태머신 · HUD 배선 · 테스트 훅
    core/noise.js         노이즈 · 감쇠 · 포맷 유틸
    scene/terrain.js      해석적 설면 높이 함수(물리·렌더 공용) + 메시
    scene/maps.js         3개 맵 데이터(팔레트·안개·파크 피처)
    scene/world.js        산맥·숲·B-net·아치·바위·레일·조명
    scene/sky.js          스카이 셰이더 + 환경맵
    scene/gates.js        게이트 · 타겟 존 · 가이드 라인
    scene/rider.js        관절 스키어 모델 + IK/포즈
    scene/effects.js      스프레이 · 스파크 · 스키 자국
    scene/camera.js       체이스 카메라
    physics/skier.js      카빙 물리 · 점프 · 레일
    audio/audio.js        Web Audio 합성
    ui/hud.js shop.js touch.js
    services/store.js leaderboard.js
vite.config.js        base '/carve-ski-game/', build outDir '../'
```

### 빌드 / 배포

```bash
npm install
npm run dev      # http://127.0.0.1:5180/carve-ski-game/
npm run build    # 저장소 루트에 index.html + assets/ 생성 (Pages 가 즉시 서빙)
```

`vite.config.js` 는 `base: '/carve-ski-game/'`, `build.outDir: '../'` 로 설정되어 있어
**GitHub Pages 설정(Deploy from branch → main / root)을 건드리지 않고도** 빌드 결과가 바로 배포됩니다.

### 검증용 훅

`window.__carve` 는 자동화 검증용입니다: `ready`, `state()`, `start(mode)`, `advance(sec)`, `freeze(v)`,
`setInput()`, `autopilot(bool)`, `teleport(z, dx)`, `inspect()`, `render()`, `quality('low'|'high')`.

## 알려진 범위

* 결제는 테스트 모드(로컬 잠금 해제)입니다. 리더보드/고스트도 로컬 저장입니다.
* 사운드는 사용자 제스처(첫 클릭/키) 이후 활성화됩니다(브라우저 정책).
