# 실시간 현황판 (`/live`)

> RFID 리더의 지금 상태를 도면 위에 얹는 벽걸이용 화면 — 연결 · 표시 · 이력 · 잔상 · 시계 편차 · MQTT 형식 · 기준정보 매핑 · 형식 프로필. [← README](../README.md)

도면 위에 **RFID 리더의 지금 상태**를 얹어 보이는 벽걸이용 화면입니다. [RfidReaderMonitor](https://github.com/SYacuCLoud/RfidReaderMonitor) 가 MQTT 브로커로 발행하는 리더 상태를 브라우저가 WebSocket 으로 직접 구독합니다. 도면 문서는 한 글자도 바꾸지 않습니다 — 이벤트가 리비전을 만들면 이력이 초 단위로 쌓이고 사람 편집과 부딪치기 때문에, 받은 값은 화면 안에만 두고 오버레이로 그립니다.

- **연결** — 기본 브로커는 도면 서버와 같은 PC 의 `ws://<서버 주소>:9001` 입니다. 구독은 `rfid/+/reader/+/state` · `…/event` · `rfid/+/host/+/status`. 주소에 `?broker=ws://…:9001&site=<사업장>&prefix=<첫 마디>` 로 바꿉니다.
- **칸과 리더 잇기** — 편집기의 **장치 대장 S/N** 이 리더의 S/N 과 같으면 그 장치가 놓인 칸입니다(여러 칸이면 모두). 대장을 안 쓰는 도면은 칸 식별자가 S/N 이나 별명과 같아도 잇습니다. 자리가 없는 리더는 오른쪽 **미배치 리더** 에 나열되어 대장 등록을 유도합니다.
- **표시** — 태그가 놓인 칸은 녹색으로 채우고 UID 끝 6자리를 적습니다. 비어 있는 칸은 파란 테두리, 감시 PC 가 끊긴 리더는 회색 점선입니다. 등장 · 제거 순간에는 칸 둘레로 초록 · 주황 테가 퍼지며 사라집니다. 리더별 현재 상태가 retained 로 오므로 화면을 늦게 켜도 접속 즉시 모든 칸이 채워집니다.
- **경과 시간** — 칸 이름 바로 아래에 `00:45` · `03:12` · `1:05:03` 처럼 초 단위로 흐르는 시간이 붙습니다. 태그가 있으면 **인식된 뒤**, 잔상이면 **들어낸 뒤** 지난 시간입니다. 기준은 발행 쪽 상태 시각이고 칸이 너무 낮으면 이 줄만 생략합니다.
- **식별 이력** — 칸(또는 오른쬽 리더 줄)을 누르면 그 리더의 등장 · 제거 목록이 뜹니다. 등장과 제거가 한 줄로 짝지어져 `무엇이 언제부터 언제까지` 로 읽히고, 기준정보가 있으면 실물 이름이 붙습니다. 기간(**오늘** · 24시간 · 3일 · 7일 · 30일 — 기본은 오늘, 이 브라우저의 0시부터)을 고르거나 `이전 … 더` 로 과거를 이어 보고(오늘이면 달력 하루씩), `CSV 내려받기` 로 지금 보이는 목록을 엑셀용(UTF-8 BOM) 파일로 받습니다(등장 · 제거 · 체류(초) · 태그 · 태그 상세 · UID · 리더 · S/N · 감시 PC · 사업장). 여러 리더를 한 번에 받으려면 오른쪽 `리더` 목록 머리의 **이력 CSV** 줄에서 범위(이 페이지 리더 · 사업장 전체)와 기간을 고르고 `내려받기` — 리더별로 짝지은 줄이 리더 이름 순으로 한 파일에 담기고 `리더` 열로 엑셀에서 가릅니다. 자료는 아래 **이벤트 로그** 입니다.
- **이벤트 로그(서버)** — 별도 프로세스 `scripts/live-logger.ts` 가 브로커의 `…/reader/+/event` 를 구독해 `.grid-projects/.live/events/YYYY-MM-DD.<표시>.jsonl` 로 하루 한 파일씩 쌓습니다(기본 30일 보관). 상시 서비스 데몬이 서버와 함께 띄우고 함께 멈춥니다. 개발 서버는 같은 코드를 프로세스 안에서 돌려 `…dev.jsonl` 에 적고, 조회할 때 두 파일의 겹친 이벤트는 하나로 합칩니다. 브로커 주소 · 보관 일수는 `.grid-projects/.live/logger.json` (`{"broker":"mqtt://127.0.0.1:1883","prefix":"rfid","retentionDays":30}`), 상태는 `/api/live/events/status`. 상시 서비스의 라우트는 Cloudflare 호환 런타임에서 돌아 `net` 이 없기 때문에 웹 서버 자신이 구독하지 않고 파일만 읽습니다.
- **잔상** — 태그를 들어낸 칸에는 **마지막에 있던 태그**가 회색 반투명 글자로 기본 **24시간** 남고, 리더 목록에도 `마지막 통번호 129 · 12분 전` 이 붙습니다. 다음 태그가 오면 사라집니다. 머리줄의 `잔상` 선택(끔 · 20분 · 1시간 · 8시간 · 24시간 · 3일)으로 바꾸면 이 브라우저에 기억되고 주소에도 `&ghost=분` 으로 실립니다(주소가 있으면 주소가 우선 — 벽걸이 PC 는 즐겨찾기로 고정). `ghost=0` 이면 끕니다. 화면을 새로 켜거나 새로 고쳐도 잔상은 남습니다 — 브로커에 붙을 때 서버 **이벤트 로그**에서 유지 시간 안의 리더별 마지막 제거를 받아(`/api/live/events/ghosts`) 비어 있는 칸에 되살리기 때문입니다(만료는 서버가 그 제거를 받은 시각 기준). 이벤트 로그가 없는 배포(정적)에서는 첫 제거를 본 뒤부터 쌓이고, 발행 쪽이 상태에 선택 필드 `lastUid` · `lastTime` 을 실어 주면 그것도 씁니다.
- **오른쪽 패널** — 태그 감지 · 배치된 리더 · 오프라인 수, 감시 PC 별 online/offline(브로커 유언으로 끊김을 바로 안다) 과 오늘 건수, 리더 목록, 최근 이벤트(등장 · 제거 · 체류 시간).
- **시계 편차** — 감시 PC 여러 대의 이벤트 시각이 한 화면에 섞이므로 PC 시계가 어긋나면 순서 · 경과 시간이 그대로 틀립니다. 현황판은 살아서 오는 하트비트(`…/host/{host}/status` 의 `time`)를 받은 순간의 자기 시계와 비교해 PC 별 편차를 재고, 30초를 넘으면 감시 PC 줄에 `시계 +3분`(PC 가 앞섬) · `시계 -45초`(늦음) 배지와 패널 위에 주황 띠를 붙입니다. 칸의 경과 시간과 `n초 전` 은 이 편차만큼 보정해 보이지만, 식별 이력 · CSV · 이벤트 로그의 시각은 그 PC 시계 그대로입니다 — 근본 해법은 감시 PC 를 같은 시각 서버(NTP · 도메인)에 맞추는 것이고 배지는 그것이 풀렸음을 알리는 신호입니다. 기준은 현황판을 보는 브라우저의 시계이므로 모든 PC 가 같은 방향으로 어긋나 보이면 그 브라우저를 의심하십시오. 구독 직후 되돌아오는 retained 하트비트와 유언(`online:false`)은 편차 계산에 쓰지 않습니다.
- **도면 따라오기** — 30초마다 서버 리비전을 확인해 편집기에서 리더를 옮기면 현황판도 옮깁니다. 페이지가 여럿이면 위 칩으로 고릅니다.
- **주소** — `/live?id=<도면 id>&page=<페이지 id>` 를 벽걸이 PC 의 즐겨찾기에 둡니다. 편집기 도구 막대의 `실시간 현황판 ↗` 이 지금 열린 도면 · 페이지의 이 주소를 새 탭으로 엽니다.
- mqtt.js 는 번들에 넣지 않고 `public/vendor/mqtt.min.js` 를 브라우저에서 늦게 읽습니다(사내망에서도 돌아야 하니 CDN 은 쓰지 않습니다). 판을 올리려면 `npm run vendor:mqtt`.

## MQTT 메시지 형식 (v1)

형식의 원본과 JSON Schema 는 발행 쪽인 [RfidReaderMonitor `docs/mqtt/`](https://github.com/SYacuCLoud/RfidReaderMonitor/tree/main/docs/mqtt) 에 있습니다. 현황판은 아래 필드만 읽고 **모르는 필드는 무시**하며, 없는 필드는 빈 값으로 칩니다. 다른 발행자(PLC 게이트웨이, Node-RED 등)도 이 필드만 채우면 현황판에 붙습니다.

| 토픽 | 현황판이 쓰는 필드 |
|---|---|
| `{prefix}/{site}/reader/{key}/state` (retained) | `serial` 로 장치 대장을 찾고(없으면 토픽의 `{key}`), `present` · `online` 으로 칸 색, `uid` 를 칸에 적음, `reader`(없으면 `alias` → `readerName`) · `host` · `state` · `time` 은 오른쪽 목록에 표시. 빈 페이로드는 그 리더를 지운 것 |
| `{prefix}/{site}/reader/{key}/event` | `kind`(`APPEAR` / `REMOVE`) 로 잔상 색, `time` · `reader` · `uid` · `dwellMs`(REMOVE) 를 최근 이벤트에. `time` + 토픽 + `kind` 가 같으면 재전송으로 보고 한 번만 |
| `{prefix}/{site}/host/{host}/status` (retained + LWT) | `online` 으로 감시 PC 점 색, `time` · `readerCount` · `onlineReaders` · `appearToday` · `removeToday` 를 타일에. 살아서 온(retained 아닌) 하트비트의 `time` 과 받은 순간의 차이가 그 PC 의 **시계 편차** |

```json
{"v":1,"type":"state","time":"2026-09-14T15:32:32.931+09:00","host":"PC-LINE1","reader":"1번 저울","alias":"1번 저울","readerName":"ACS ACR1552 1S CL Reader PICC 0","serial":"RR657-005592","present":true,"online":true,"uid":"E0040150ABCDEF01","tech":"ISO 15693","state":"PRESENT"}
{"v":1,"type":"event","time":"2026-09-14T15:32:40.000+09:00","kind":"REMOVE","reader":"1번 저울","serial":"RR657-005592","uid":"E0040150ABCDEF01","dwellMs":7069,"host":"PC-LINE1"}
{"v":1,"type":"status","online":true,"host":"PC-LINE1","time":"2026-09-14T15:32:33.931+09:00","version":"0.4.0","readerCount":2,"onlineReaders":2,"presentReaders":1,"appearToday":5,"removeToday":4}
```

`time` 은 ISO 8601(밀리초 · 시간대 오프셋 포함), `uid` 는 16진 대문자입니다. 토픽 첫 마디 `prefix` 는 무엇이든 받고(구독 필터가 이미 고른 뒤라 따지지 않습니다), `{key}` 는 발행 쪽이 리더 S/N → 별명 → 이름 순으로 채운 값입니다. 해석 코드는 [app/live/liveState.ts](../app/live/liveState.ts) 이고 `tests/live-state.test.mjs` 가 지킵니다.

## 기준정보 매핑 — UID 를 실물 이름으로

리더는 UID 만 줍니다. 그것이 어느 통(桶)인지, 누구의 사원증인지는 회사 기준정보(대개 SQL Server 의 표)에 이미 있으므로, 현황판은 **그 표의 열과 열을 짝짓는 설정**만 받아 UID 대신 이름을 보입니다. 별도의 태그 대장을 만들지 않습니다 — 원본은 한 곳(회사 DB)이어야 합니다.

- **동작** — 도면 서버가 설정에 적힌 표를 **주기적으로 통째로 읽어** 메모리에 들고(`/api/lookup`), 브라우저는 그 스냅샷 하나로 UID 를 찾습니다. 이벤트마다 DB 에 묻지 않으므로 DB 가 멀거나 잠깐 끊겨도 마지막 스냅샷으로 계속 돕니다. 오른쪽 패널 **기준정보** 칸에 행 수 · 마지막 읽은 시각 · 오류 · `새로고침` 이 있습니다.
- **표시** — 태그가 놓인 칸에는 UID 끝자리 대신 실물 이름(`통번호 129`)이 적히고, 폭에 안 들어가면 글자를 줄이다가 UID 로 물러납니다. 리더 목록에는 `통번호 129 · 칼작업분배`, 최근 이벤트에도 이름이 붙습니다. 기준정보에 없는 UID 는 `미등록 태그` 로 표시됩니다.
- **두 층으로 나뉩니다.** 접속(어느 DB, 어떤 계정)은 관리자가 서버 파일로, 매핑(어느 표의 어느 열, 무엇을 이름으로, 몇 분마다)은 사용자가 화면에서 정합니다. 비밀번호와 자유 SQL 은 브라우저에 절대 나가지 않습니다.
- **인증은 없습니다.** 편집기 전체가 사내망 신뢰 모델이라 설정 창과 `/api/lookup` · `/api/live` 도 같은 망의 누구나 쓸 수 있습니다. 저장자 이름과 시각만 파일에 남습니다. 인터넷에 직접 열어 두지 마십시오.
- **설정 화면** — 기준정보 칸의 `설정`(설정이 없으면 `설정 만들기`). 접속 이름을 고르면 그 DB 의 **표 목록**이, 표를 고르면 **열 목록**이 뜹니다(INFORMATION_SCHEMA). UID 열과 형식(16진수 · 바이트 역순), 칸에 적을 제목 · 부제 템플릿(`{열이름}` — `열 넣기…` 로 조립), 상세에 보일 열과 표시 이름, 조건(`열 · 연산자 · 값`, 모두 AND), **다시 읽는 주기(초)** 를 정하고 `미리보기` 로 5행을 실제 값으로 본 뒤 `저장하고 바로 읽기`. 저장자 이름과 시각이 함께 남습니다.
- **접속 파일(관리자)** — `.grid-projects/.lookup/connections.json`. 이름 → env 파일(`_env` 규칙: `SERVER` · `DATABASE` · `USERNAME` · `PASSWORD`). 예시는 [docs/lookup.connections.example.json](./lookup.connections.example.json). 계정은 그 표 **SELECT 권한만** 있으면 됩니다 — 이 기능은 쓰기가 없습니다.
- **매핑 파일** — `.grid-projects/.lookup/{사업장}.json` (사업장 = MQTT 토픽의 `{site}`, 보통 `default`). 설정 화면이 쓰는 파일이고 손으로 고쳐도 다음 갱신(또는 `새로고침`)에 반영됩니다. 예시는 [docs/lookup.example.json](./lookup.example.json).

```json
{
  "v": 1,
  "source": { "kind": "mssql", "connection": "MES", "table": "dbo.tb_rfid_card", "filters": [{ "column": "사용여부", "op": "ne", "value": "0" }] },
  "key": { "column": "카드번호", "format": "hex" },
  "display": { "title": "{정의구분} {정의번호}", "subtitle": "{정의명}" },
  "columns": [ { "column": "정의구분", "label": "구분" }, "정의번호", "정의명", { "column": "등록일자", "label": "등록일" } ],
  "refreshSeconds": 300
}
```

- `key.field` 는 MQTT 메시지 쪽 필드입니다. 기본 `uid`(태그 UID, 태그가 놓여 있을 때만 이름이 붙음). `serial` 로 바꾸면 리더 S/N 으로 **리더 대장**을 잇고 태그가 없어도 리더에 이름이 붙습니다. `reader` · `alias` · `readerName` · `key` · `host` · `tech` 도 되고, 다른 발행자의 필드 이름(`epc` 등)은 직접 적습니다.
- `key.format` 이 `hex` 면 리더의 `C6 11 7A …` 와 DB 의 `c6117a…` 를 16진수만 남겨 대문자로 맞춰 비교합니다. DB 가 바이트를 거꾸로 저장했다면 `"reverseBytes": true`. 문자 키(카드 번호 문자열)는 `"text"`.
- `display.title` · `subtitle` 은 `{열이름}` 자리표시 템플릿입니다. 제목이 쓰는 열은 `columns` 에 없어도 읽습니다. `columns` 는 스냅샷에 실어 상세(툴팁)에 보일 열 — 여기 적지 않은 열은 서버 밖으로 나가지 않습니다.
- 조건 연산자는 `eq`(=) · `ne`(≠, NULL 포함) · `contains`(LIKE) · `empty` · `notEmpty` 입니다. 값은 리터럴로만 들어가고 식별자는 대괄호로 감싸므로 표 · 열 이름에 대괄호 · 공백 · 따옴표는 쓸 수 없습니다. 그 이상의 조건이 필요하면 관리자가 파일에 `source.where`(자유 SQL, 화면에는 있다는 사실만 보임)를 적거나 DB 에 뷰를 만듭니다.
- 접속 이름 없이 `source.env` 로 env 파일을 직접 가리키는 구식 설정도 그대로 읽습니다. 화면에서 접속 이름을 고르면 그쪽으로 바뀝니다.
- 지금은 `mssql` 소스만 있습니다. 순수 계산은 [app/live/lookup.ts](../app/live/lookup.ts), DB 읽기 · 접속은 `server/lookupStore.ts`, 경로 규칙은 `server/lookupRouter.ts`, 화면은 `app/live/LookupSettings.tsx`, `tests/lookup.test.mjs` 가 지킵니다.

## 메시지 형식 프로필 — 다른 발행자의 페이로드 받기

위 "MQTT 메시지 형식 (v1)" 은 RfidReaderMonitor 가 내는 모양입니다. PLC 게이트웨이 · Node-RED 처럼 `{"tag":{"epc":"…"},"detected":"ON","ts":1789443082}` 식으로 다르게 내는 발행자는 **형식 프로필**로 맞춥니다. 토픽 구조(`{prefix}/{site}/reader/{key}/state` 등)는 그대로여야 합니다 — 구독 필터와 칸 잇기 규칙이 거기 걸려 있습니다.

- **화면** — 머리줄 접속 표시 옆 `형식 v1`(또는 `형식 사용자 정의`). 상태 · 이벤트 · PC 상태 세 탭에 현황판이 쓰는 필드 목록이 있고, 필드마다 **JSON 경로**(`tag.epc`, `readers[0].id`)를 적습니다. 오른쪽에 그 사업장에서 **마지막에 실제로 받은 메시지 원문**이 떠 있고, 경로를 고치면 표에서 "표본에서 읽은 값" 이 바로 바뀝니다(표본에 없는 경로는 노랗게). 아래에 값 해석 — 참으로 볼 글자 값(`ON`, `1` …), 제거로 볼 kind 값(`OUT` …), 시각 해석(자동 · ISO · epoch ms · epoch s). `저장하고 다시 읽기` 를 누르면 브로커에 다시 붙어 retained 를 새 프로필로 읽습니다. `기본값(v1)으로` 되돌리면 파일이 지워집니다.
- **파일** — `.grid-projects/.live/{사업장}.json`. 없는 사업장은 v1 입니다. 안 적은 필드는 v1 경로(= 필드 이름), 빈 경로는 "읽지 않음" 입니다.
- **규칙** — `present` · `online` 은 불리언 · 숫자를 그대로, 글자는 참 목록에 있을 때만 참. `online` 경로가 표본에 없으면 살아 있는 것으로 봅니다. `kind` 는 제거 목록에 있으면 제거, 아니면 등장. `time` 이 숫자면 epoch(자동은 크기로 ms/s 판단), 글자면 그대로. `dwellMs` 는 숫자 글자도 받습니다.
- 순수 계산은 [app/live/messageFormat.ts](../app/live/messageFormat.ts)(경로 · 값 해석 · 미리보기), 메시지 반영은 `app/live/liveState.ts` 의 `applyMessage(…, book)`, 파일은 `server/formatStore.ts`, 화면은 `app/live/FormatSettings.tsx`, `tests/message-format.test.mjs` 가 지킵니다.
