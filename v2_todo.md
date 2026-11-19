# RustPlusPlus v2 기능 현황

2026-11-19 기준. 독립 저장소의 `main`과 레거시 `master` (`257edd6`)를 비교했다. 아래의 구현 여부는 명령 등록, 데이터 출처, 이벤트 처리 경로를 기준으로 한다.

## Facepunch가 Rust+에서 제거하거나 제한한 기능

| 기능 | 공식 변경 | main에 미치는 영향 |
| --- | --- | --- |
| 자판기 검색·시세 | 자판기 지도 마커 전송 중단 | `market` 및 자판기 생성·소멸 알림의 기존 데이터 출처가 사라졌다. `deepsea`도 심해 자판기로 이벤트를 추정하므로 빈 결과로 종료 여부를 알 수 없다. [Power Trip](https://rust.facepunch.com/news/power-trip) |
| 화물선·헬기·이동 상인 | 이들 이벤트의 지도 마커 전송 중단 | `cargo`, `chinook`, `heli`, `travellingvendor`의 위치·생성·소멸과 화물선 접안·출항·이탈 추정이 영향을 받는다. [Power Trip](https://rust.facepunch.com/news/power-trip) |
| 잠긴 상자·폭발 | 상자와 폭발 지도 마커 전송 중단 | 상자 투하·해제, 화물선 상자, 헬기 파괴 및 `large`·`small`의 오일 리그 이벤트 추정에 필요한 관측값이 사라졌다. [R.U.S.T.](https://rust.facepunch.com/news/r-u-s-t) |
| CCTV 실시간 영상 | 정적 카메라 원격 시청 금지. 허용된 카메라도 해당 서버에 게임으로 접속한 동안에는 Rust+에서 시청할 수 없다. | `/cctvcodes`는 로컬 파일의 코드 목록을 보여 주므로 계속 사용할 수 있다. [R.U.S.T.](https://rust.facepunch.com/news/r-u-s-t) |

`src/structures/rustPlusMapMarkers.ts`와 관련 명령에는 과거 마커 처리 코드가 남아 있다. 빈 마커 목록을 공식 서버에서 이벤트가 없다는 증거로 사용할 수 없다. 페어링한 스마트 스위치 제어와 스마트 알람 푸시는 공식 Rust+ 기기 기능이다. [Rust+ Devices](https://rust.facepunch.com/companion/)

## main에서 구현한 기능

| 영역 | 사용 가능한 범위 |
| --- | --- |
| Discord | `/alias`, `/blacklist`, `/cctvcodes`, `/credentials`, `/help`, `/map`, `/reset`, `/role`, `/voice`. `/smartswitch edit`, `/smartalarm edit`, `/storagemonitor edit`는 장치 이미지를 편집한다. |
| 게임 명령 | `afk`, `alive`, `connection`, `connections`, `death`, `deaths`, `marker`, `mute`, `note`, `offline`, `online`, `pop`, `prox`, `say`, `send`, `team`, `time`, `timer`, `unmute`, `wipe`. 이벤트 마커 의존 명령은 위 표 참조. |
| 서버·Discord 설정 | 길드 카테고리·채널, 설정 메뉴, 서버 목록과 연결, 정보 채널의 지도·팀·서버 이벤트 카드. 이벤트 카드의 정확도는 서버가 제공하는 입력에 달려 있다. |
| Rust+ 기반 | relay 및 직접 연결, 계정별 FCM 리시버, 팀 채팅, 서버·팀·시간·지도 폴링, 지도 렌더링. |
| 스마트 스위치 | 게임 내 페어링, Discord ON/OFF, 게임에서 변경한 상태 표시, 연결 복구 시 서버 상태 재조회. 연결을 잃으면 상태를 미확인으로 표시한다. Discord 변경의 게임 채팅 알림은 길드 설정을 따른다. |

## master에서 아직 이식할 기능

| 영역 | 남은 작업 또는 의존성 |
| --- | --- |
| 스마트 스위치 | 그룹과 그룹 채널, 게임 내 사용자 지정 스위치 명령, 자동 제어(낮·밤·근접·팀 접속), 카드의 편집·삭제 동작. |
| 스마트 알람·저장 모니터 | 두 장치의 페어링·카드 생성과 알람 FCM의 Discord 알림은 구현돼 있다. 알람 카드의 실시간 상태, 저장 모니터의 종류·재고·TC 유지 시간 조회와 변경 처리가 남았다. |
| 아이템·RustLabs | `src/staticFiles`에 원본 JSON이 있다. 조회 모듈, 데이터 최신성 검증, `/item`과 `craft`, `decay`, `despawn`, `recycle`, `research`, `stack`, `upkeep`의 Discord·게임 명령이 남았다. |
| 팀·유틸리티 | Discord·게임의 `leader`, `uptime`, 게임의 `steamid`, `translate`, `tts`. `events` 요약 명령도 미이식이며 표시할 수 있는 항목은 위 마커 제한을 따른다. |
| 플레이어·트래커 | BattleMetrics 조회 모듈·핸들러, Discord `/players`, 게임 `player`, 트래커 채널과 정보 채널 플레이어 목록. 외부 API 접근 권한과 데이터 가용성은 별도 확인 대상이다. |

## 기존 TODO의 추가 아이디어

- 가장 가까운 기념물과 거리를 알려 주는 `monument` 명령.
- 길드의 뉴스 수신 계정(`newsReceiver`) 지정·변경 및 만료 시 대체 계정 선택.

## 스마트 스위치 동작과 검증

1. 게임에서 스위치를 페어링하고 Discord 서버 목록에서 해당 Rust 서버에 연결한다. 장치 페어링이 먼저 도착해도 서버와 장치가 함께 등록된다.
2. 연결 시 `getEntityInfo`로 읽은 값이 스위치 카드에 표시된다. ON/OFF 버튼은 `setEntityValue`의 성공 응답을 확인한다. 게임에서 직접 조작하면 `entityChanged`가 같은 카드를 갱신한다.
3. 연결이 끊기면 조작 버튼이 비활성화된다. 재연결은 각 장치의 현재 상태를 다시 읽는다. 연결 중 장치가 응답하지 않으면 카드에서 상태 조회를 재시도할 수 있다.
4. 직접 연결은 장치를 페어링한 계정의 서버 토큰을 사용한다. relay는 연결 시 인증한 계정으로 요청하므로 다른 계정에만 페어링한 스위치는 해당 계정을 서버 요청자로 선택해야 한다. 소유 계정 기록이 없는 기존 장치는 현재 요청자로 조회한다.

`npm test`에 [계정별 FCM 페어링 테스트](tests/fcm.test.cjs)와 [스위치 통합 테스트](tests/smart-switch.test.cjs)가 포함된다. 통합 테스트는 빌드된 봇, 로컬 WebSocket 서버, 모의 Discord 전송을 사용하며, 연결 중단 중에 바뀐 두 장치가 조회 요청 두 건으로 복구되는지 검사한다. 실서비스의 Discord·Rust 서버 왕복 검증은 남아 있다.
