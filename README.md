# moyami · Moya-mini

Moya의 UI와 리더를 바탕으로 만든 경량 만화·소설 웹 리더입니다. Mangayomi JavaScript 확장 소스로 탐색하고, 최근 읽기에서 이어 읽습니다. 데스크톱과 모바일 브라우저, 설치형 PWA를 지원합니다.

- 만화: 스크롤·이음새 없음·한 쪽·두 쪽 보기, 앞뒤 이미지 준비
- 소설: 스크롤·페이지 보기, 글꼴·테마·읽기 위치·북마크
- 확장 저장소 직접 등록, 확장 코드·메타데이터의 브라우저 캐시
- 아이디·비밀번호 로그인, 가입 키로만 가입, 관리자 초대
- **기기 간 동기화는 제공하지 않습니다.** 읽기 기록과 리더 설정은 이 브라우저에 계정별로 저장됩니다. 서버에는 계정과 인증 정보, 짧게 유지되는 실행 상태만 저장합니다.

## 배포

**[① 가입 키 만들기 → ② Vercel 배포 시작](https://west-truth.github.io/moyami/)**

배포 준비 화면이 열리지 않으면 [public/deploy.html](public/deploy.html)을 다운로드해서 브라우저로 열어도 됩니다. 키는 브라우저에서 무작위로 만들며 서버로 보내거나 배포 URL에 넣지 않습니다.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fwest-truth%2Fmoyami&env=BOOTSTRAP_KEY%2CSITE_NAME&envDescription=BOOTSTRAP_KEY%3A%20Generate%20and%20save%20a%20first-signup%20key%20using%20the%20setup%20page.%20SITE_NAME%3A%20Your%20app%20name.&envLink=https%3A%2F%2Fwest-truth.github.io%2Fmoyami%2F&envDefaults=%7B%22SITE_NAME%22%3A%22moyami%22%7D&products=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22upstash%22%2C%22productSlug%22%3A%22upstash-kv%22%2C%22protocol%22%3A%22storage%22%7D%5D)

1. 준비 화면에서 **가입 키 생성**을 누르고 키를 복사하거나 파일로 보관합니다.
2. **Vercel 배포 시작**을 누릅니다. GitHub·Vercel 계정을 연결하고 저장소·프로젝트 이름을 원하는 대로 정합니다.
3. Upstash Redis를 연결합니다. 무료로 시작하려면 플랜과 사용량 조건을 확인하고 무료 플랜을 선택합니다. 외부 서비스 약관 동의는 계정 소유자가 진행합니다.
4. `BOOTSTRAP_KEY`에 보관한 키를 붙여 넣습니다. `SITE_NAME`은 원하는 앱 표시 이름입니다.
5. 배포된 주소에서 첫 가입 키, 아이디, 비밀번호를 입력해 **관리자 계정**을 만듭니다. 다음 접속부터는 아이디·비밀번호만 사용합니다.
6. **소스 관리 → 저장소 추가**에서 사용할 Mangayomi JS 저장소 주소를 직접 입력하고 소스를 선택합니다. 기본으로 설치되는 저장소나 소스는 없습니다.

배포된 페이지에 설정 안내가 나온다면 Vercel **Storage/Marketplace**에서 Upstash를 해당 프로젝트에 연결하고 다시 배포하세요. `KV_REST_API_URL`/`KV_REST_API_TOKEN` 또는 `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`이 필요합니다. 앱마다 전용 DB를 연결하는 것을 권장합니다.

### 주소와 이름

Vercel의 프로젝트 이름과 `*.vercel.app` 주소는 배포자가 정합니다. 개인 도메인은 Vercel **Settings → Domains**에서 연결합니다. `SITE_NAME`을 바꾸고 다시 배포하면 앱 제목과 PWA 이름에 반영됩니다.

브라우저 연결 확장 패키지는 배포된 앱의 주소에 맞춰 빌드합니다. 개인 도메인을 추가했다면 `APP_URL=https://내-도메인`을 설정하고 재배포한 뒤 확장 패키지를 다시 설치하세요. 여러 주소를 쓰면 `CONNECTOR_READER_ORIGINS`에 쉼표로 구분해 넣습니다.

### 가입 키와 계정

- 첫 키는 첫 관리자 가입에만 사용합니다. 첫 가입 이후 같은 키로 추가 가입할 수 없습니다.
- 관리자는 **설정 → 계정 → 가입 키 발급**에서 24시간 동안 한 번 쓸 수 있는 키를 발급합니다. 발급 화면에서 해당 키를 취소할 수 있습니다.
- 비밀번호는 salt를 포함한 scrypt 해시로, 세션·초대 키는 해시로 저장합니다. 로그아웃 시 서버 세션도 폐기합니다.
- 인증 시도 횟수 제한은 Redis에서 인스턴스 간 공유됩니다. 로컬 단일 서버에서는 계정 파일에 유지합니다.
- 계정 DB와 배포 환경변수를 보관하세요. 비밀번호 분실 시 이메일 복구 기능은 없습니다. `BOOTSTRAP_KEY`는 환경설정에 유지해야 하며 바꿔도 기존 계정은 초기화되지 않습니다.
- Vercel Preview에 운영 DB를 연결하면 운영 계정을 공유합니다. 별도 테스트 DB를 사용하거나 테스트용 `AUTH_NAMESPACE`를 지정하세요. 기존 앱의 namespace를 변경하면 별도 계정 공간으로 전환됩니다.

### 원본 사이트 연결

무료 호스팅에 배포해도 원본 사이트의 Cloudflare 인증·IP 차단이 자동으로 해결되지는 않습니다. 실행 가능한 JS 확장 범위도 저장소별로 다릅니다. 필요한 경우 **설정 → 연결**에서 브라우저 연결 확장 또는 서버 프록시를 사용합니다.

설치 패키지는 PC Chromium 계열·Firefox용 개발자 설치 ZIP을 제공합니다. Android Firefox와 iOS/iPadOS Safari의 일반 사용자 배포에는 각각 서명·Apple 배포 절차가 필요합니다. iPhone/iPad에서 사이트 자체가 서버 접근을 차단하면 PWA 설치만으로 해결되지 않습니다.

## 로컬 실행

Node.js 22가 필요합니다. 서버에 Chromium을 설치할 필요는 없습니다.

```sh
npm ci
cp .env.example .env
# .env의 BOOTSTRAP_KEY를 준비 화면에서 생성한 키로 채우세요.
npm run build
node --env-file=.env --import tsx server/index.ts
```

기본 주소는 `http://127.0.0.1:4173`입니다. 계정은 `data/auth.json`에 저장되므로 이 디렉터리를 보관하세요. 파일 저장은 단일 서버 프로세스용이며 여러 인스턴스에는 Redis를 사용합니다.

Docker를 쓰고 싶다면 환경변수를 작성한 뒤 `docker compose up -d --build`로 실행합니다. 계정 파일은 `accounts` 볼륨에 보관합니다. HTTPS 프록시 뒤에서는 `COOKIE_SECURE=1`을 설정하세요.

## 개발·검증

```sh
npm run build
npm test
# 실제 Redis Lua 테스트까지 실행하려면 임시 Redis 포트를 지정합니다.
REDIS_TEST_PORT=6379 npm test
# Chromium 실행 파일 경로를 설정하면 브라우저 회귀 테스트를 실행할 수 있습니다.
MOYA_SOURCE_BROWSER_EXECUTABLE=/path/to/chromium npm run test:auth
MOYA_SOURCE_BROWSER_EXECUTABLE=/path/to/chromium npm run test:browser
MOYA_SOURCE_BROWSER_EXECUTABLE=/path/to/chromium npm run test:pwa
# Vercel과 동일한 빌드 (로컬에서는 자신의 앱 주소가 필요)
APP_URL=https://reader.example.com npm run build:hosting
```

`public/deploy.html`이 배포 도우미 원본이며 `npm run build:client`가 GitHub Pages용 `docs/index.html`을 갱신합니다. 키나 개인 환경설정은 커밋하지 않습니다.

## 라이선스

Apache-2.0. [LICENSE](LICENSE), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), [Moya UI 출처](vendor/moya-ui/README.md)를 확인하세요. 확장 소스와 원본 콘텐츠의 권리·이용 조건은 각 제공자에게 있습니다.
