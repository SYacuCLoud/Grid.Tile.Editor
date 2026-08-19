import type { ZodRawShape } from "zod";
import type { ProjectStore } from "./store";

/**
 * MCP 도구 한 개의 정의.
 *
 * `handler` 는 MCP 전송 계층을 모른다. 검증되지 않은 인자를 받아 스스로 zod 로
 * 검사하고 평범한 객체를 돌려주므로, 단위 테스트에서 서버를 띄우지 않고 그대로
 * 부를 수 있다.
 */
export interface ToolDef {
  name: string;
  title: string;
  description: string;
  /** MCP 에 노출할 입력 스키마(zod raw shape). */
  inputSchema: ZodRawShape;
  handler: (args: unknown, store: ProjectStore) => Promise<unknown> | unknown;
}

/** 도구 실패는 이 오류로 던진다. 서버가 사용자에게 보일 한 줄로 바꾼다. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}
