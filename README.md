# CARVE RUSH 2.1 — 3D 알파인 스키 (WebGL)

`https://1usenoah.github.io/carve-ski-game/` 에서 바로 플레이할 수 있는 **Three.js 기반 3D 스키 레이싱 게임**입니다.
2.0 의 세계·물리 위에 **조작감, 게이트 코스, 크라우칭 자세, 모드별 점프 분리**를 다시 얹고,
`carvemania.com` 의 실제 플레이 화면을 레퍼런스로 HUD·카메라·게이트·레이싱 라인을 맞췄습니다.

![Race](https://img.shields.io/badge/mode-RACE-5ef0d8) ![Park](https://img.shields.io/badge/mode-PARK-ff5fa2) ![Vite](https://img.shields.io/badge/build-Vite%205-646cff) ![three](https://img.shields.io/badge/three.js-r169-000000)

## 플레이 방법 (v2.1)

| 입력 | 동작 |
| --- | --- |
| `←` `→` (A / D) | 카빙 — 입력 즉시 에지가 물고, 호는 그대로 살아 있습니다 (steer 9.6 / edge 9.0 댐핑) |
| `↑` (W) / `Shift` | 턱 — 알파인 다운힐 에어로 크라우칭 |
| `↓` (S) | 브레이크 |
| `Space` | 점프 — **PARK 모드 전용**. RACE 에서는 입력 자체를 무시합니다 |
| `Enter` | 메뉴에서 선택한 런 시작 |
| `P` / `O` | 상점 · `Esc` 일시정지 · `M` 음소거 |

**모바일**은 화면을 **좌우로 드래그**하면 그 비례만큼 부드럽게 카빙하고(화면 좌/우 절반을 눌러도 조향),
아래로 스와이프하면 브레이크입니다. 하단 UI 는 `BRAKE` · `CROUCH` 두 개의 홀드 버튼만 남았고,
`AIR` 버튼은 RACE 모드에서 `display:none` 으로 완전히 사라집니다(PARK 에서만 등장).

### 모드

* **RACE** — 슈퍼G 코스 16개 게이트, 실시간 타이머, Gold/Silver/Bronze(**Course Setter** 패널에 목표 기록 표시),
  최고 기록과 **고스트 리플레이**. 게이트를 통과할 때 레이싱 라인 기준으로 판정합니다
  (`APEX PERFECT` / `CLEAN LINE` / `TIGHT CARVE` / `WIDE LINE`), `MISSED GATE` 는 +2초 페널티. **점프 없음.**
* **PARK** — 게이트 없이 킥커 3개와 레일 2개에서 에어타임·스핀·그라인드를 쌓는 프리 라이드. 점프는 여기서만.

## v2.1 에서 바뀐 것

**조작**
* 터치 드래그(아날로그 조향 `input.axis`) + 좌/우 절반 홀드 + 아래로 스와이프 브레이크.
* `steer` 댐핑 7 → **9.6**, `edge` 댐핑 4.2 → **9.0**, 최대 에지 58° → **64°**, 선회 상한 1.45 → 1.7 rad/s.
  답답하던 턴이 즉각적으로 붙으면서도 `ω = g·tan(edge)/v` 카빙 아치는 유지됩니다.
* 하단 터치 UI 정리: `BRAKE` / `CROUCH` 홀드 패드 + 드래그 안내만.

**게이트 코스**
* 좌우로 리드미컬하게 꺾이는 슈퍼G 세팅(`offsetFor`) — 게이트 사이 13 m 내외의 규칙적인 사인 궤적.
* 발광 가이드가 **실제 카빙 라인**을 그립니다: 각 게이트 안쪽 폴을 스치는 **Apex** 를 찍고, 게이트 사이에서
  바깥으로 벌렸다가 다시 안으로 꺾여 들어오는 점선(다음 2개 게이트까지 미리 보임).
* **게이트 폴 힌지**: 안쪽 폴을 스치면 폴이 스프링처럼 뒤/옆으로 꺾였다가(피크 ≈ 0.33 rad, 약 0.43초에 복귀)
  타격음과 눈 파편을 남기고 제자리로 돌아옵니다.
* 게이트 비주얼을 **세로 배너 패널 + 힌지 폴**로 교체(레드/블루 교대, 스노우 위 게이트 라인 포함).

**크라우칭**
* `rider.js` 의 턱 포즈를 실제 다운힐 에어로 자세로: 몸통을 지면과 **6.7°**(≈83° 숙임)까지 눕히고,
  엉덩이 0.98 → **0.46 m**, 어깨 1.35 → **0.52 m** 로 낮추며, 무릎을 깊게 접고 양팔을 가슴 앞으로 모아
  폴대를 몸통 옆·뒤로 일직선으로 눕힙니다(팔 길이 계산 버그도 함께 수정).
* 턱 시 항력 감소 + 가속 보너스, 추적 카메라 FOV 확대, 화면 속도선 오버레이로 속도감을 같이 올렸습니다.

**점프 제거 (RACE)**
* `Space` 입력은 RACE 에서 무시되고, 모바일 `AIR` 버튼은 `body.race` 에서 `display:none`.
  물리도 `input.allowJump === false` 로 한 번 더 막습니다.

**레퍼런스(carvemania.com) 반영**
* 카메라를 더 낮고 가깝게(4.15 m + 속도 보정, 높이 1.82 m), 세로 화면에서는 FOV 를 자동으로 넓혀 라이더가 프레임에 남습니다.
* HUD 재구성: 상단 중앙 대형 타이머 + 국기 바 + PB 스트립, 좌상단 코스 칩/일시정지, 우상단 **Course Setter** 목표 기록,
  좌하단 속도·게이트 카운터, 하단 중앙 조작 힌트.
* 메뉴를 `PICK YOUR FIRST RUN` 2장 카드(RACE/PARK, 인게임 아트)로 교체. 모드 전환 중 재구성 프레임에서 생기던 예외도 수정.

### 상점 (테스트 결제)

스킨 4종(Classic / Neon Cyber / Crimson Pro / Golden Legend)과 맵 3종(Larchwood / Glacier / Midnight)을
**테스트 결제**로 잠금 해제합니다. 실제 금액은 청구되지 않으며 보유 상태는 `localStorage`(`carve.store.v2`)에 저장됩니다.
실서비스 연동 지점은 `src/services/store.js` 의 `purchase()` 하나이며, 서버 결제 확인 콜백에서 `grant()` 를 호출하도록 교체하면
게임 코드는 그대로 유지됩니다. 리더보드/고스트도 `src/services/leaderboard.js` 의 동일한 경계로 분리되어 있습니다.

## v2.0 기반 위에 남아 있는 것

**게이트 공략 가이드**
* 게이트에서 다음 게이트로 이어지는 **발광 점선 레이싱 라인**(커스텀 셰이더, 흐르는 대시) — v2.1 에서 Apex 궤적으로 교체.
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
