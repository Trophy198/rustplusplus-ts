# Rust+ 프로토콜 변경 확인

공식 Rust+ 웹 앱의 JavaScript 구문 트리에서 protobufjs 디코더를 읽어, 직전에 관측한 번들과 비교합니다. 각 브랜치의 lockfile이 가리키는 라이브러리 스키마를 기준으로 적용할 패치를 생성합니다. 봇 실행과 Discord·Steam 자격증명은 필요하지 않습니다.

## 실행

Node.js 20 이상, Git, `protoc`(proto3 optional 지원), `diff -u -L`을 사용합니다. macOS와 Linux에서 저장소 루트를 기준으로 실행합니다.

```sh
npm ci --prefix tools/rustplus-protocol
node tools/rustplus-protocol/check.mjs --refresh-refs
```

아래 명령은 실행 중에 60분마다 확인합니다. Ctrl+C로 종료합니다. 관측 간격 사이에 교체된 중간 배포는 건너뛸 수 있습니다.

```sh
node tools/rustplus-protocol/check.mjs --watch 60 --refresh-refs
```

기본 비교 대상은 로컬 Git의 `origin/master`와 `origin/alle_playground`입니다. `--refresh-refs`는 두 원격 ref를 먼저 fetch합니다. 현재 작업 브랜치의 로컬 rustplus-ts까지 비교하려면 `--playground-ref HEAD`를 붙입니다. 이때 해당 커밋의 워크스페이스 스키마를 읽습니다. 다른 포크나 작업 브랜치는 `--master-ref`, `--playground-ref`로 지정합니다. npm 의존성은 lockfile 무결성과 일치하는 배포 메타데이터의 `gitHead`로 소스를 조회합니다.

## 결과 읽기

출력된 `report.md`를 엽니다. 기본 경로는 Git에서 제외된 `temp/rustplus-protocol/<순번>/`이며, 장기 보관할 디렉터리는 `--state DIR`로 지정합니다.

- **이전 번들과의 차이**에는 메시지 안의 태그 번호별 이전·현재 이름, 타입, 반복 여부와 필수 검사 변화, enum 값의 추가·삭제가 나옵니다. 첫 실행은 기준점입니다. 브랜치만 바뀐 경우에도 직전의 서로 다른 번들이 비교 기준으로 유지됩니다.
- **브랜치별 수정 후보**에는 새 필드·타입·enum 값과 같은 부호의 32비트 → 64비트 정수 확장이 나옵니다. 태그 재사용, 이름 충돌, 타입 교체, 삭제된 필드 등은 수동 검토 목록에 남습니다. 기존 브랜치의 전용 선언과 주석을 보존합니다.
- 각 브랜치 폴더에는 `original.proto`, `rustplus.proto`, `protocol.patch`가 있습니다. 원본과 수정 후보 모두 `protoc` 검사를 거칩니다. 런타임의 필수 값 검사와 사용자 권한은 호출 코드에서 별도로 확인합니다.
- `snapshot.json`에는 번들의 SHA-256, URL, 브랜치 커밋과 스키마 출처, 메시지·enum이 들어 있습니다. WebSocket URL 및 서브프로토콜 메서드에서 관측한 문자열도 기록합니다. 푸시 구독의 실제 전달과 릴레이 인증 성공 여부는 라이브 연결 검증 대상입니다.
- 인식할 수 없는 번들 구조나 컴파일 오류가 발생하면 stderr로 오류를 표시합니다. 두 브랜치의 결과가 완성된 실행만 이력에 추가합니다.

`protocol.patch`의 대상은 보고서에 표시한 **라이브러리 소스 커밋**입니다. 해당 라이브러리 체크아웃에서 `git apply --check /absolute/path/to/protocol.patch`로 확인한 뒤 적용할 수 있습니다. `master`는 포크의 루트 `rustplus.proto`를 사용합니다. `alle_playground`의 `rustplus-ts`는 `src/protos/rustplus.proto`에서 `npm run protogen`과 `npm run build`를 실행하고 `src/validation.ts`를 확인해야 합니다. 검증한 라이브러리 버전을 각 봇 브랜치의 의존성과 lockfile에 반영합니다.

## 보관한 소스로 비교 재현

아래 세 파일을 지정하면 번들과 스키마를 로컬에서 읽습니다. 같은 상태 디렉터리에서 번들 파일을 바꿔 실행하면 두 버전을 비교할 수 있습니다. 두 Git ref는 브랜치 코드의 연결·페어링 처리 위치를 확인하는 데 사용합니다.

```sh
node tools/rustplus-protocol/check.mjs --state /tmp/rustplus-history \
  --bundle ./app.js --master-proto ./master.proto --playground-proto ./playground.proto
npm test --prefix tools/rustplus-protocol
```
