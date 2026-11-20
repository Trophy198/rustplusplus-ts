# rustplusplus v2 TODO

체크박스는 `alle_playground` 원본의 진행 표시입니다. **Rust+ 제한**은 Facepunch가 데이터 제공이나 접근을 중단한 범위입니다. [마커 변경](https://rust.facepunch.com/news/power-trip) · [CCTV 및 상자·폭발 마커 변경](https://rust.facepunch.com/news/r-u-s-t)

## Slash commands
- [x] smartalarm
- [x] alias
- [x] blacklist
- [x] cctvcodes
- [ ] craft         Requires rustlabs data
- [x] credentials
- [ ] decay         Requires rustlabs data
- [ ] despawn       Requires rustlabs data
- [x] help
- [ ] item
- [ ] leader — **main 구현** `/leader member`로 팀원에게 위임. 현재 리더의 서버 페어링 사용
- [x] map
- [ ] market — **Rust+ 제한** 자판기 상품·가격 조회
- [ ] players — **main 구현** `/players name`은 Rust+ 팀원의 접속 상태와 서버 전체 인원수를 표시합니다. `/players link`로 서버 ID를 연결하고 `.env`에 `RPP_BATTLEMETRICS_TOKEN`을 설정하면 공개 온라인 명단을 이름 또는 `/players playerid`로 검색할 수 있습니다. BattleMetrics API 이용 권한이 필요하며 서버 전체의 오프라인·이름 변경 이력은 제공하지 않습니다.
- [ ] recycle       Requires rustlabs data
- [ ] research      Requires rustlabs data
- [x] reset
- [x] role
- [ ] stack         Requires rustlabs data
- [x] storagemonitor
- [x] smartswitch
- [ ] upkeep
- [ ] uptime
- [x] voice

## In-Game commands
- [x] afk
- [x] alive
- [x] cargo — **Rust+ 제한** 화물선 위치와 입출항
- [x] chinook — **Rust+ 제한** CH47 위치와 이벤트
- [x] connection
- [ ] craft         Requires rustlabs data
- [x] death
- [ ] decay         Requires rustlabs data
- [x] deepsea — **Rust+ 제한** 자판기 마커로 추정하던 활성 시간
- [ ] despawn       Requires rustlabs data
- [ ] events — **Rust+ 제한** 아래 RustPlus events의 마커 기반 이벤트
- [x] heli — **Rust+ 제한** 순찰 헬기 위치와 격추
- [x] large — **Rust+ 제한** 대형 오일리그 중무장 과학자 호출과 상자 타이머
- [ ] leader — **main 구현** `!leader`로 자신에게, `!leader 이름` 또는 `!leader SteamID`로 팀원에게 위임
- [x] marker
- [ ] market — **Rust+ 제한** 자판기 상품·가격 조회
- [x] mute
- [x] note
- [x] offline
- [x] online
- [ ] player — **main 구현** `!player 이름` 또는 `!players`로 온라인 이름을 검색합니다. BattleMetrics를 사용할 수 없으면 Rust+ 팀원 명단에서 검색합니다.
- [x] pop
- [x] prox
- [ ] recycle       Requires rustlabs data
- [ ] research      Requires rustlabs data
- [x] send
- [x] small — **Rust+ 제한** 소형 오일리그 중무장 과학자 호출과 상자 타이머
- [ ] stack         Requires rustlabs data
- [ ] steamid — **main 구현** `!steamid`는 팀 채팅 발신자의 Steam ID를, `!steamid 이름`은 현재 팀원의 Steam ID를 표시합니다. 이름 일부로도 검색할 수 있습니다.
- [x] team
- [x] time
- [x] timer
- [ ] translate
- [x] travellingvendor — **Rust+ 제한** 이동 상인 위치
- [ ] tts
- [x] unmute
- [ ] upkeep        Requires rustlabs data
- [ ] uptime
- [x] wipe

## Other not prioritised new commands
- [ ] monument (which monument is the closest and distance to it).

## Setup functions
- [ ] Smart switches
- [ ] Smart alarms
- [ ] Storage monitors
- [ ] Smart switch groups — **main 구현** 서버·개별 스위치 카드의 그룹 만들기 버튼, 여러 스위치 동시 선택, 재연결 및 `/reset channel` 후 복구. `/switchgroup`에서 생성·편집·삭제와 멤버 추가·제거
- [ ] Guild category
- [ ] Guild channels
- [ ] Server list
- [x] Settings menu
- [ ] Trackers

## Battlemetrics
- [ ] Class
- [ ] handler

## Modules
- [ ] Rustlabs
- [x] CCTV — **Rust+ 제한** 오일리그 등 고정 CCTV 원격 시청. 코드 목록은 계속 사용할 수 있고, 개인 카메라는 해당 서버에서 게임을 종료한 계정으로 시청 가능
- [ ] Items

## RustPlus

### Classes
- [x] Time
- [x] Team
- [x] TeamMember
- [x] Info
- [x] MapMarkers — **Rust+ 제한** 자판기·이벤트·상자·폭발 마커
- [x] Map

### Handlers
- [ ] Smart switch
- [ ] Smart alarm
- [ ] Storage monitor
- [ ] Smart switch groups — **main 구현** Discord 카드에서 ON/OFF, 이름·명령어 편집, 스위치 추가·제거, 멤버별 상태 확인. 게임에서 `!그룹명령 status`, `!그룹명령 on`, `!그룹명령 off` 지원. `!그룹명령 on 30s`는 상태가 확인된 멤버를 30초 뒤 OFF로 전환. 새 그룹 제어, 멤버 변경, 재연결 시 예약 취소
- [x] inGame command handler
- [x] discord command handler
- [x] information channel — **Rust+ 제한** 제거된 마커에 의존하는 이벤트 표시
- [x] inGame chat handler
- [x] team chat handler
- [x] team handler
- [x] time handler
- [ ] vending machine handler — **Rust+ 제한** 자판기 마커 수신

### RustPlus events

**Rust+ 제한** 아래 이벤트는 기존 구현이 사용한 마커가 제거되어 공식 Rust+로 감지할 수 없습니다.

- [x] Vending Machine spawned
- [x] Vending Machine despawned
- [x] CH47 spawned
- [x] CH47 despawned
- [x] CH47 destroyed
- [x] Locked crate dropped
- [x] Heavy scientists called to oil rig
- [x] Locked crate unlocked at oil rig
- [x] cargoship spawned
- [x] cargoship despawned
- [x] cargoship leaving
- [x] cargoship docking
- [x] cargoship docked
- [x] cargoship undocking
- [x] cargoship locked crate spawned
- [x] patrol helicopter spawned
- [x] patrol helicopter despawned
- [x] patrol helicopter destroyed
- [x] patrol helicopter leaving
- [x] travelling vendor spawned
- [x] travelling vendor despawned

## Trackers
- [ ] Class
- [ ] Handler


## Other todo:
- gInstance.newsReceiver:
    - Decide when this should be set. Perhaps set as soon as the first credentials are added?
    - Perhaps in the future this could be set automatically based on which credentials are not expired etc
    - Make it possible to set this from a slash command?
