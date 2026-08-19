// Cloudflare Worker 전역 타입(Fetcher, D1Database, cloudflare:workers 모듈 등).
// 이게 없으면 worker/ 와 db/ 가 타입 검사에서 실패한다.
/// <reference types="@cloudflare/workers-types" />

// `cloudflare:workers` 의 `env` 는 `Cloudflare.Env` 를 쓴다. 선언 병합으로 바인딩을 알려 준다.
// (`wrangler types` 로 자동 생성할 수도 있다.)
declare namespace Cloudflare {
  interface Env {
    ASSETS: Fetcher;
    // `.openai/hosting.json` 에서 d1 을 켜지 않으면 런타임에 없을 수 있어
    // `db/index.ts` 가 직접 확인한다.
    DB: D1Database;
  }
}
