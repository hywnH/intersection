
# Intersection

============

모바일 웹 기반 인터랙티브 사운드·비주얼 설치 작품 **Intersection (Harmony · Dimension · Universe)**의 작업 저장소입니다.  
각 참여자는 자신의 행성(planet)을 들고 우주 공간에 입장하고, 보이지 않는 중력 힌트를 따라 서로를 찾아 닿는 순간 화음이 쌓이며 흔적이 남습니다. 개인은 나만의 차원을 탐색하고, 글로벌 화면에서는 모든 궤적의 합주가 시각·청각화됩니다.

## Project Snapshot

- **Thesis**: 인간은 본능을 공유하며, 상호작용을 통해 서로의 차원을 단편적으로 이해할 수 있다.
- **형태**: 스마트폰을 통한 개인 뷰 + 전시장 글로벌 디스플레이.
- **핵심 메타포**: Harmony(동조) · Dimension(개별 세계) · Intersection(교차) · Gravity(끌림과 흔적).

## Experience

- **Personal View**: 빈 우주와 나의 pulse sphere만 보이며, 주변 참여자는 중력 힌트(사운드·비주얼 왜곡)로 감지합니다. 근접하면 화음이 한 음씩 쌓이고 잔향 흔적이 남습니다.
- **Global View**: 모든 행성과 흔적이 실시간으로 시각화되며 공간 전체의 합주가 들립니다. 흔적은 서서히 희미해지지만 완전히 사라지지는 않습니다.
- **접근성 고려**: 청각 피드백의 진동 대체, 감광 민감 사용자 대응, 개인 식별 정보 비노출.

## Core Interaction Rules

- 내 행성만 가시화되며 타인은 중력 힌트로만 존재감을 드러냅니다.
- 거리 감소에 따라 오디오 변조와 표면 파동이 강해집니다.
- 일정 거리 이하에서 `HarmonyEvent`가 발생하여 코드톤이 추가되고 흔적이 생성됩니다.
- 흔적은 지수 감쇠 곡선을 따르며 전시 설정에 따라 잔존 시간을 조정할 수 있습니다.

## System Overview

현재 코드는 Agar.io 오픈소스 기반을 리서치·프로토타이핑용으로 가져온 상태입니다. 구조를 재정비하며 Intersection 전용 기능을 단계적으로 이식합니다.

- **Client**: Three.js(WebGL), Tone.js(WebAudio)를 목표로 하는 모바일 웹앱.
- **Server**: Node.js + WebSocket 상태 동기화, Redis 기반 pub/sub 검토 중.
- **Infra**: Docker, Nginx, SSL 구성 예정. (CDN/전시장 네트워크는 전개 단계에서 확정)

## Getting Started (WIP)

Intersection 전용 코드가 정리되는 동안 기본적인 Node.js 실행 흐름을 유지합니다.

```bash
npm install
npm start
```

기본 포트는 `http://localhost:3000`이며, 설정은 `config.js`에서 조정할 수 있습니다. 향후 개인/글로벌 뷰를 분리하는 신규 클라이언트가 추가될 예정입니다.

## Roadmap

- **v0.1**: 개인/글로벌 뷰 뼈대, 중력 힌트, 접촉 이벤트의 최소 기능.
- **v0.2**: 성운 흔적 스타일 확장, 하모니 보이싱 로직 고도화.
- **v0.3**: Room 관리, 접근성 옵션 프리셋, 전시장 운영 툴킷.
- **v1.0**: 전시장 배포 패키지 및 운영 가이드 완성.

## 참고

- **레퍼런스 연구**: Kirschner & Tomasello (2010), Mehr et al. (2019), West–Eastern Divan Orchestra.
- **작업 문서**: 프로젝트 전반의 세부 설계는 `README-02.md`에서 확인할 수 있습니다.
