# Intersection - README.md

> 우리는 얼마나 다른 세상에 살고 있든 **인간이기에 같은 본능을 공유**하며 **상호작용을 통해 서로를 이해**할 수 있다.

---

## 1) 프로젝트 개요

* **프로젝트명:** Intersection (Harmony · Dimension · Universe)
* **형태:** 모바일 웹 기반 인터랙티브 사운드/비주얼 설치
* **핵심 아이디어:**
  각 참여자는 자신의 “행성(planet)”을 들고 우주에 들어옵니다. 보이지 않는 **중력 힌트**(오디오·비주얼)를 따라 서로를 찾아 **닿는 순간 화음이 쌓이고 흔적이 남는** 경험을 설계합니다.
개인은 **나의 세계(차원)**를 탐색하고, 글로벌 화면에서는 **모두의 궤적(교차)**이 하나의 합주로 시각·청각화됩니다.

---

## 2) 주제 (Thesis)

> **“인간은 본능을 공유한다.** 그래서 전혀 다른 차원에 있어도, **상호작용을 통해 단편적으로 서로를 이해**할 수 있다.”

---

## 3) 레퍼런스 / 근거

* **Initial Inspiration** — *Daniel Barenboim & West–Eastern Divan Orchestra*
  갈등 지역의 청년들이 음악을 통해 공존을 실험한 사례.

* **Joint Drumming Cooperation Experiment** — *Kirschner & Tomasello, 2010*
  동시성(synchrony)으로 함께 연주한 아동이 이후 과제에서 **협력 성향**이 높아짐을 보임.

* **Universality in Human Song** — *Mehr et al., 2019 (Harvard)*
  문화권이 달라도 낯선 노래의 **감정 범주(자장가/춤/치유)**를 높은 정확도로 식별.

---

## 4) 개념 메타포

### 4.1 Harmony = Coordinated Difference

* 인간은 리듬에 **동조(entrainment)**하는 경향이 있음
* 동시 움직임/발성은 **친밀감·공감·협력 의지**를 안정적으로 증대
* **공유된 의도성** → **감정의 동기화** → **상호 이해**

### 4.2 Dimension & Intersection

* “우리는 서로의 **내면 세계**(차원)를 직접 볼 수 없다.
  하지만 **상호작용**(교차)을 통해 그 단편을 엿본다.”
* 차원은 개인의 사적 관점, 교차는 이해 가능성의 창.

### 4.3 Universe & Gravity

* **모든 세계는 고유한 중력**을 가진다. 보이지 않아도 **끌림**으로 존재를 감지.
* **상호작용은 흔적**(성운/폐허)을 남기고, 떠난 뒤에도 **의미를 지속**시킨다.

---

## 5) 경험 설계 (Experience Design)

### 5.1 개인 뷰 (Personal)

* **접속:** 각자 스마트폰으로 웹에 접속 → **빈 우주 + 앰비언트 사운드**
* **나의 행성:** 오디오 **pulse sphere**로 표현 (호흡 같은 파형)
* **탐색:** 타인은 **보이지 않음**. 대신 가까운 타인의 존재가 **조석(tide)처럼** 내 pulse와 사운드를 왜곡
  (예: 템포 미세 변화, 필터 컷오프 스윕, 파형 당김)
* **접촉(닿음):** 화음이 **한 음씩 쌓임**(Chord stacking) → 짧은 **잔향 트레일**이 공간에 남음
* **흔적:** 이 인터랙션은 **성운/궤적 오브젝트**로 남아 이후 탐색의 단서가 됨

### 5.2 글로벌 뷰 (Global)

* **모든 행성과 흔적**이 실시간으로 시각화
* 현재 공간의 **합주(집합 화음)**가 들림 (믹스는 다이내믹 레인지 자동 관리)

---

## 6) 핵심 인터랙션 규칙

* **가시성:** 내 행성만 보임(개인 뷰). 타인의 영향은 **중력 힌트(오디오/비주얼 왜곡)**로만 감지.
* **근접도 → 변조 강도:** 거리 ↓ → **오디오 변형↑ / 구체 표면 파동↑**
* **접촉 이벤트:** 일정 거리 이하 진입 시 `HarmonyEvent` 발생 → 코드톤 추가, 흔적 생성
* **흔적 지속:** 시간에 따라 **희미해지되** 완전히 사라지지 않는 **장기 메모리층** 존재(설정 가능)

---

## 7) 시스템 설계 개요

### 7.1 기술 스택 (제안)

* **Client:** WebGL(Three.js) / WebAudio(Tone.js) / PWA / DeviceMotion(옵션)
* **Server:** Node.js + WebSocket (state sync), Redis(pub/sub), REST for history
* **Infra:** Docker, Nginx, Optional CDN(정적 자산), SSL

### 7.2 아키텍처 다이어그램 (Mermaid)

```mermaid
flowchart LR
  A[Mobile Client<br/>Three.js + Tone.js] -- WS Sync --> B[Realtime Gateway<br/>(WebSocket)]
  A -- REST --> C[API Server]
  B <--> D[State Store<br/>Redis]
  C --> E[(DB<br/>PostgreSQL)]
  C --> F[Object Storage<br/>Traces/Presets]
  G[Global Display Wall] -- WS/REST --> B
```

### 7.3 데이터 모델(요약)

* **UserSession** `{ id, joinedAt, deviceInfo }`
* **Planet** `{ userId, position(x,y,z), velocity, toneProfile, pulsePhase }`
* **HarmonyEvent** `{ id, userA, userB, time, position, chord, intensity }`
* **Trace** `{ id, type(nebula|trail), path[], createdAt, decayUntil }`
* **GlobalMix** `{ activeVoices, rms, limiterState }`

---

## 8) 알고리즘 설계 (요점)

### 8.1 중력 힌트(근접 감지)

* **근사 중력 강도:** `g = k / (d^2 + ε)`
* **오디오 매핑:**

  * `filterCutoff = base - α * g`
  * `tremoloDepth = β * g`
  * `tempoNudge = clamp(γ * g, ±Δbpm)`
* **비주얼 매핑:**

  * 구 표면 노멀 디스토션, 파티클 스트림 굴절량에 `g` 가중

### 8.2 접촉 판정 & 화음 스태킹

* **접촉 임계:** `d < r_contact` → `HarmonyEvent`
* **코드 진행:** 키 서클 기반, **사용자 수/접촉 빈도**로 보이싱 선택
* **충돌 스팸 방지:** `cooldown` + `voice stealing` + `look-ahead limiter`

### 8.3 흔적(Trace) 감쇠

* `opacity(t) = exp(-λ * t)`
* 상호작용 강도·지속시간에 따라 초기 α 가중치 부여

---

## 9) 오디오/비주얼 디자인 가이드

* **Ambience:** 숨결 같은 **롱테일 패드**, 로우 노이즈, 미세 모듈레이션
* **Harmony:** 4도/5도 중심, **서로 다른 음색이 섞여도 탁해지지 않게** 대역 분할
* **Dynamics:** **오토 게인/리미터** 상시 동작(폰 스피커 과변위 방지)
* **Visuals:** 딥 스페이스 + **소프트 글로우**, 과한 번쩍임 금지(감광 민감 사용자를 고려)

---

## 10) UX 흐름 (모바일)

1. **Onboarding(10초):** 헤드폰 권장, 소리 테스트, 간단한 제스처 안내
2. **탐색 모드:** 드래그/버튼으로 미세 추진(또는 자이로 옵션)
3. **근접 힌트:** 미세한 템포·톤 변화 + 표면 파동
4. **접촉:** 짧은 빛 번쩍 + 코드톤 추가, 진동(haptics) 피드백
5. **흔적 보기:** 내/타인의 남긴 성운 확인(개인 뷰 비공개, 글로벌 뷰 집계)
6. **글로벌 감상:** 대형 스크린에서 합주 + 궤적 맵 시청

---

## 11) 접근성 & 윤리

* **청각 대체 피드백:** 진동, 화면 파형 증폭
* **광과민 반응 배려:** 번쩍임 빈도 제한, 감광 세이프 팔레트
* **프라이버시:** 타인의 정확한 위치/ID는 **비가시화**, 서버엔 **비식별 세션키**만 저장
* **콘텐츠 안전:** SPL 제한, 이어폰 볼륨 가이드

---

## 12) 성능 & 네트워킹

* **전송:** 10–20Hz 저주기 상태 전송, 클라이언트 보간/예측
* **혼잡 제어:** 패킷 드롭 시 로컬 물리 시뮬 보정, 오디오 아티팩트 최소화
* **스케일링:** 룸(shard) 단위 분산, 글로벌 뷰는 **샘플링 집계**로 경량화

---

## 13) 측정 지표 (KPI)

* **Discovery Time:** 타인 접촉까지 평균 시간
* **Harmony Depth:** 세션당 누적 코드 스택 수
* **Trace Retention:** 흔적 재방문/상호작용 비율
* **Affective Uplift(옵션):** 사전/사후 간단 감정 태그 변화

---

## 14) 개발 가이드

### 14.1 폴더 구조(예시)

```
/client
  /assets
  /components
  /scenes
  /audio
  /net
  main.tsx
/server
  /api
  /ws
  state.ts
/shared
  types.ts
```

### 14.2 환경 변수

* `WS_URL` — WebSocket 게이트웨이
* `API_URL` — REST API 엔드포인트
* `ROOM_ID` — 전시장 세션 키

### 14.3 로컬 실행(예시)

```bash
# server
cd server && npm i && npm run dev
# client
cd client && npm i && npm run dev
```

---

## 15) 테스트 시나리오 (요약)

* **단독 사용자:** 근접 힌트가 0일 때 안정적인 앰비언스 유지
* **2인 접촉:** 접촉 직후 코드톤·잔향·흔적 생성 확인, 중복 트리거 방지
* **다중 사용자:** 믹스 리미터 동작, 프레임/오디오 드랍 없이 유지
* **네트워크 변동:** 지터/패킷 손실 시 보간·재동기 성능 검증

---

## 16) 로드맵

* v0.1: 기본 물리·오디오·접촉 이벤트, 개인/글로벌 뷰
* v0.2: 성운 흔적 스타일 확장, 하모니 보이싱 알고리즘 고도화
* v0.3: Room 관리/샤딩, 접근성 옵션 프리셋
* v1.0: 전시장 배포 프리셋(스태프 패널, 벽면 디스플레이 모드)

---

## 17) 참고 문헌

* Kirschner, S., & Tomasello, M. (2010). *Joint music-making promotes prosocial behavior in 4-year-old children.*
* Mehr, S. A., et al. (2019). *Universality and diversity in human song.*
* West–Eastern Divan Orchestra, Daniel Barenboim — 사례 리서치

---

## 18) 크레딧

* **Concept & Design:**
* **Audio/Visual Engineering:**
* **Development:**
* **Production & Exhibition:**

> 질문 없이 바로 제작 시작할 수 있도록 핵심 규칙·데이터·흐름을 정리했습니다. 필요한 경우 배포/전시장 세팅 체크리스트와 세부 음원·머티리얼 프리셋도 이어서 드릴게요.
