/**
 * 브라우저용 mqtt.js 를 `<script>` 로 늦게 불러온다.
 *
 * `import "mqtt"` 로 묶으면 서버 렌더(RSC · SSR · Worker) 번들에까지 Node 용 빌드가
 * 따라 들어와 빌드가 깨지거나 무거워진다. 현황판은 브라우저에서만 브로커에 붙으므로
 * 번들 밖에 둔 파일(`public/vendor/mqtt.min.js`, `npm run vendor:mqtt` 로 갱신)을
 * 그때 읽는다. 사내망에서도 돌아야 하니 CDN 은 쓰지 않는다.
 */

import type { IClientOptions, MqttClient } from "mqtt";

export interface MqttGlobal {
  connect(url: string, options?: IClientOptions): MqttClient;
}

declare global {
  interface Window {
    mqtt?: MqttGlobal;
  }
}

export const MQTT_SCRIPT = "/vendor/mqtt.min.js";

let loading: Promise<MqttGlobal> | null = null;

export function loadMqtt(): Promise<MqttGlobal> {
  if (typeof window === "undefined") return Promise.reject(new Error("브라우저에서만 쓸 수 있습니다."));
  if (window.mqtt) return Promise.resolve(window.mqtt);
  if (loading) return loading;
  loading = new Promise<MqttGlobal>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = MQTT_SCRIPT;
    script.async = true;
    script.onload = () => {
      if (window.mqtt) resolve(window.mqtt);
      else reject(new Error("mqtt.js 를 읽었지만 window.mqtt 가 없습니다."));
    };
    script.onerror = () => {
      loading = null;
      reject(new Error(`${MQTT_SCRIPT} 를 읽지 못했습니다.`));
    };
    document.head.appendChild(script);
  });
  return loading;
}
