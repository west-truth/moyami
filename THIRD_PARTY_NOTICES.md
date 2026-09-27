# Third-party notices

의존성 버전은 `package.json`과 `package-lock.json`으로 고정한다. 라이선스 전문은 설치된 패키지에 포함된다.

- QuickJS WASM: `quickjs-emscripten-core`, `@jitl/quickjs-wasmfile-release-sync`, `@jitl/quickjs-ffi-types` (MIT 및 포함된 QuickJS 고지)
- DOM parsing: `linkedom` (ISC)
- 브라우저 호스트의 동기 AES 호환: `@noble/ciphers` (MIT)
- Proxy transports: `agent-base`, `https-proxy-agent`, `socks`
- TypeScript execution: `tsx`; build: `esbuild`, `typescript`
- 개발/진단 전용 browser automation: `playwright-core`. 운영 이미지에는 Playwright/Chromium을 포함하지 않는다.

Worker에 번들된 코드와 WASM의 라이선스는 빌드 시 `/runtime/THIRD_PARTY_LICENSES.txt`에도 포함한다. 개발 의존성을 서버에서 제거해도 이 고지는 유지한다. Debian 패키지는 각 라이선스를 따르며 `/usr/share/doc`을 삭제하지 않는다.

Mangayomi JavaScript 확장은 지정한 외부 저장소에서 실행 시점에 가져온다. 확장과 원문 콘텐츠의 저작권·이용 조건은 해당 제공자에게 있다.

과거 Headless Shell 비교용 `scripts/Dockerfile.patchright-probe`는 기존 진단 이미지 `moya-source-lite:headless`에 Apache-2.0의 `patchright-core` 1.63.0을 추가한다. 제품 빌드와 분리된 실험이며 서버 브라우저 fallback을 제공하지 않는다.
