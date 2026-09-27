# moyami · Moya-mini

**[Moya Reader 바로가기](https://west-truth.github.io/moya-reader/)** · [Moya Reader 프로젝트](https://github.com/west-truth/moya-reader)

Moya의 UI와 리더를 바탕으로 만든 경량 만화·소설 웹 리더입니다. Mangayomi JavaScript 확장 소스로 탐색하고, 최근 읽기에서 이어 읽습니다. 데스크톱과 모바일 브라우저, 설치형 PWA를 지원합니다.

- 만화: 스크롤·이음새 없음·한 쪽·두 쪽 보기, 앞뒤 이미지 준비
- 소설: 스크롤·페이지 보기, 글꼴·테마·읽기 위치·북마크
- 확장 저장소 직접 등록, 확장 코드·메타데이터의 브라우저 캐시
- 아이디·비밀번호 로그인, 가입 키로만 가입, 관리자 초대
- 같은 계정으로 로그인한 기기 사이에서 읽기 기록·이어읽기 위치·저장소 목록 동기화. 표지와 리더 설정은 기기마다 보관합니다.

## 배포

**[① 가입 키 만들기 → ② Vercel 배포 시작](https://west-truth.github.io/moyami/)**

배포 준비 화면이 열리지 않으면 [public/deploy.html](public/deploy.html)을 다운로드해서 브라우저로 열어도 됩니다. 키는 브라우저에서 무작위로 만들며 서버로 보내거나 배포 URL에 넣지 않습니다.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fwest-truth%2Fmoyami&env=BOOTSTRAP_KEY%2CSITE_NAME&envDescription=BOOTSTRAP_KEY%3A%20Generate%20and%20save%20a%20first-signup%20key%20using%20the%20setup%20page.%20SITE_NAME%3A%20Your%20app%20name.&envLink=https%3A%2F%2Fwest-truth.github.io%2Fmoyami%2F&envDefaults=%7B%22SITE_NAME%22%3A%22moyami%22%7D&products=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22upstash%22%2C%22productSlug%22%3A%22upstash-kv%22%2C%22protocol%22%3A%22storage%22%7D%5D)

1. 준비 화면에서 **가입 키 생성**을 누르고 키를 복사하거나 파일로 보관합니다.
2. **Vercel 배포 시작**을 누릅니다. GitHub·Vercel 계정을 연결하고 저장소·프로젝트 이름을 원하는 대로 정합니다.
3. **Upstash Redis**를 연결하는 화면이 나오면 저장 공간을 하나 만듭니다. 로그인 계정과 읽기 기록을 보관하는 작은 온라인 저장 공간입니다. 무료로 시작하려면 요금제에서 **Free(무료)**를 선택하고, 화면의 동의·연결 버튼을 눌러 진행하세요.
4. `BOOTSTRAP_KEY`에 보관한 키를 붙여 넣습니다. `SITE_NAME`은 원하는 앱 표시 이름입니다.
5. 배포된 주소에서 첫 가입 키, 아이디, 비밀번호를 입력해 **관리자 계정**을 만듭니다. 다음 접속부터는 아이디·비밀번호만 사용합니다.
6. **소스 관리 → 저장소 추가**에서 사용할 Mangayomi JS 저장소 주소를 직접 입력하고 소스를 선택합니다. 기본으로 설치되는 저장소나 소스는 없습니다.

### 앱을 열었는데 “저장 공간 연결이 필요합니다”라고 나오나요?

앱은 만들어졌지만 **계정과 읽기 기록을 보관할 저장 공간이 아직 연결되지 않은 상태**입니다. 다음 순서로 연결하면 됩니다.

1. [Vercel 대시보드](https://vercel.com/dashboard)에 로그인하고, 방금 만든 **내 moyami 프로젝트**를 엽니다.
2. **Storage(저장 공간)** 탭에서 **Create Database(저장 공간 만들기)**를 누릅니다. Marketplace 화면이 나오면 **Upstash → Redis**를 선택하세요.
3. 처음 사용한다면 안내에 따라 계정을 연결하고 새 저장 공간을 만듭니다. 이름은 `my-moyami`처럼 알아보기 쉽게 정하면 됩니다. 무료로 쓰려면 **Free** 요금제를 선택하세요.
4. **Connect to Project(프로젝트에 연결)**가 나오면 내 moyami 프로젝트를 선택합니다. 사용할 환경을 묻는다면 **Production(실제 서비스)**을 선택하고 연결을 완료합니다.
5. 프로젝트의 **Deployments(배포 내역)** 탭을 엽니다. 가장 최근 배포의 **⋯ → Redeploy(다시 배포)**를 누르고 완료될 때까지 기다립니다. *새로 연결한 저장 공간을 앱에 적용하는 과정입니다.*
6. 내 앱 주소를 새로고침합니다. 가입 화면이 보이면 완료입니다. 처음 만든 가입 키로 관리자 계정을 만드세요.

이미 저장 공간을 만들었다면 새로 만들 필요 없이 해당 저장 공간을 열어 **내 프로젝트에 연결되어 있는지** 확인하세요. 처음에는 moyami용으로 하나를 따로 만드는 편이 다른 앱과 헷갈리지 않습니다.

**정상적으로 연결되면 복잡한 주소나 토큰을 직접 복사할 필요가 없습니다.** 연결에 필요한 값은 Vercel이 자동으로 넣어줍니다. 화면 이름이 다르면 [Vercel의 저장 공간 안내](https://vercel.com/docs/marketplace-storage) 또는 [Upstash 연결 안내](https://upstash.com/docs/redis/howto/vercelintegration)를 참고하세요.

<details>
<summary>연결했는데도 안 될 때만 확인하는 고급 설정</summary>

Vercel 프로젝트의 **Settings → Environment Variables**에서 다음 두 쌍 중 하나가 있는지 확인하세요. 같은 줄의 주소와 토큰이 모두 있어야 합니다.

| 저장 공간 주소 | 접속 토큰 |
| --- | --- |
| `KV_REST_API_URL` | `KV_REST_API_TOKEN` |
| `UPSTASH_REDIS_REST_URL` | `UPSTASH_REDIS_REST_TOKEN` |

값이 없다면 저장 공간 연결을 다시 확인하세요. 값을 추가하거나 수정했다면 **Redeploy**가 필요합니다. 토큰은 비밀번호와 같으므로 다른 사람에게 공개하지 마세요.

`BOOTSTRAP_KEY` 안내가 나온다면 저장 공간 문제가 아니라 **첫 가입 키가 빠진 상태**입니다. [배포 준비 페이지](https://west-truth.github.io/moyami/)에서 키를 만들고 보관한 뒤, **Environment Variables**에 이름 `BOOTSTRAP_KEY`, 값에 생성한 키를 추가하고 다시 배포하세요.

</details>

### 다른 기기에서 이어 읽기

휴대폰과 PC에서 **같은 앱 주소에 같은 계정으로 로그인**하면 됩니다. 첫 로그인과 앱으로 돌아왔을 때 기록을 받아오고, 읽는 동안 생긴 변경사항은 모아서 약 15초 간격으로 저장합니다. 바로 옮겨 읽으려면 **설정 → 계정 → 지금 동기화**를 누르세요.

| 함께 저장되는 항목 | 각 기기에만 남는 항목 |
| --- | --- |
| 최근 읽은 작품·회차, 만화 페이지·소설 읽던 위치 | 표지 이미지와 표지 주소, 작품 본문·만화 이미지 |
| 회차 읽음·안 읽음 표시 | 글꼴·글자 크기·읽기 방식 등 리더 설정 |
| 확장 저장소 목록, 고정한 소스 | 소스의 로그인 정보·개별 옵션, 연결 방식, 북마크·메모, 회차 제목 수정 |

다른 기기에는 처음에 표지가 없을 수 있습니다. 작품을 열거나 이어 읽으면 해당 소스에서 표지를 다시 받아 **그 기기에 보관**합니다. 이미지 파일은 동기화 저장 공간에 올리지 않습니다.

연결이 끊겨도 변경사항은 이 기기에 남겨두며, 연결이 돌아오거나 다음 접속 시 다시 저장합니다. 동시에 같은 기록을 수정했다면 서버에 먼저 저장된 변경을 적용합니다. 서로 다른 작품의 기록은 따로 합칩니다. 최근 읽기에서 삭제한 기록도 다른 기기에 반영합니다.

**5MiB는 누적 전송량이 아니라 서버에 현재 보관 중인 데이터의 한도입니다.** 같은 작품의 최근 읽기와 같은 회차의 위치는 최신 값으로 교체하므로, 1쪽 → 2쪽 → 3쪽으로 이동해도 위치 기록은 하나입니다. 수정 전 값을 모아두는 변경 이력은 저장하지 않습니다. 서로 다른 회차의 마지막 위치·읽음 표시와 삭제 표시는 별도 항목으로 남습니다.

계정당 동기화 데이터는 **최대 5MiB·3,000항목**으로 제한합니다. 항목은 작품 기록, 회차 위치, 읽음 표시 등을 각각 셉니다. 한도에 도달하면 설정에 안내하고, 새 변경사항은 이 기기에 보관합니다. 삭제 상태도 항목에 포함됩니다. 요금제 사용량에는 저장 용량뿐 아니라 요청 횟수도 포함되므로, 페이지를 넘길 때마다 서버에 보내지 않고 변경을 모아 전송합니다.

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

기본 주소는 `http://127.0.0.1:4173`입니다. 계정과 동기화 데이터는 `data/auth.json`에 저장되므로 이 디렉터리를 보관하세요. 파일 저장은 단일 서버 프로세스용이며 여러 인스턴스에는 Redis를 사용합니다.

Docker를 쓰고 싶다면 환경변수를 작성한 뒤 `docker compose up -d --build`로 실행합니다. 계정 파일은 `accounts` 볼륨에 보관합니다. HTTPS 프록시 뒤에서는 `COOKIE_SECURE=1`을 설정하세요.

## 개발·검증

```sh
npm run build
npm test
# 실제 Redis Lua 테스트까지 실행하려면 임시 Redis 포트를 지정합니다.
REDIS_TEST_PORT=6379 npm test
# Chromium 실행 파일 경로를 설정하면 브라우저 회귀 테스트를 실행할 수 있습니다.
MOYA_SOURCE_BROWSER_EXECUTABLE=/path/to/chromium npm run test:auth
MOYA_SOURCE_BROWSER_EXECUTABLE=/path/to/chromium npm run test:sync
MOYA_SOURCE_BROWSER_EXECUTABLE=/path/to/chromium npm run test:browser
MOYA_SOURCE_BROWSER_EXECUTABLE=/path/to/chromium npm run test:pwa
# Vercel과 동일한 빌드 (로컬에서는 자신의 앱 주소가 필요)
APP_URL=https://reader.example.com npm run build:hosting
```

`public/deploy.html`이 배포 도우미 원본이며 `npm run build:client`가 GitHub Pages용 `docs/index.html`을 갱신합니다. 키나 개인 환경설정은 커밋하지 않습니다.

## 라이선스

Apache-2.0. [LICENSE](LICENSE), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), [Moya UI 출처](vendor/moya-ui/README.md)를 확인하세요. 확장 소스와 원본 콘텐츠의 권리·이용 조건은 각 제공자에게 있습니다.
