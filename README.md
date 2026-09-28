# moyami

**[배포 가이드](https://west-truth.github.io/moyami/)** · **[Moya Reader](https://github.com/west-truth/moya-reader)** · [Moya Reader 바로 써 보기](https://west-truth.github.io/moya-reader/)

Mangayomi JavaScript 확장 소스로 만화와 소설을 찾아 읽는 개인용 웹 리더입니다. [Moya Reader](https://github.com/west-truth/moya-reader)의 화면과 리더를 가볍게 옮겨 와, Vercel 무료 요금제에 5분 안에 내 리더를 만들 수 있게 했습니다. 데스크톱·모바일 브라우저와 설치형 앱(PWA)에서 쓸 수 있습니다.

도움이 됐다면 ⭐ **Star**로 응원해 주세요. [moyami](https://github.com/west-truth/moyami) · [Moya Reader](https://github.com/west-truth/moya-reader)

## 주요 기능

- **만화** — 세로 스크롤·이음새 없는 스크롤·한 쪽·두 쪽 보기, 다음 이미지 미리 받기
- **소설** — 스크롤·페이지 보기, 글꼴·테마, 읽던 위치·북마크·메모
- **확장 소스** — Mangayomi JS 저장소를 직접 등록하고, 자주 쓰는 소스는 탭에 고정
- **계정** — 아이디·비밀번호 로그인, 가입 키로만 가입, 관리자 초대
- **기기 간 이어 읽기** — 같은 계정이면 읽던 작품·위치·저장소 목록을 휴대폰과 PC가 공유
- **매끄러운 화면** — 작품을 누르면 제목과 표지가 먼저 보이고, 회차를 넘기면 다음 화 카드가 나타납니다. 불러오는 중 뒤로 가면 보던 화면과 스크롤 위치로 돌아갑니다.

## 시작하기

**[배포 가이드 열기](https://west-truth.github.io/moyami/)** 에서 버튼을 차례로 누르면 됩니다. 필요한 것은 GitHub 계정과 Vercel 계정(GitHub로 가입 가능)뿐입니다.

[![Vercel로 배포](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fwest-truth%2Fmoyami&env=BOOTSTRAP_KEY%2CSITE_NAME&envDescription=BOOTSTRAP_KEY%3A%20%EB%B0%B0%ED%8F%AC%20%EA%B0%80%EC%9D%B4%EB%93%9C%EC%97%90%EC%84%9C%20%EC%83%9D%EC%84%B1%ED%95%9C%20%EC%B2%AB%20%EA%B0%80%EC%9E%85%20%ED%82%A4%20%2832%EC%9E%90%20%EC%9D%B4%EC%83%81%29.%20SITE_NAME%3A%20%EC%9B%90%ED%95%98%EB%8A%94%20%EC%95%B1%20%ED%91%9C%EC%8B%9C%20%EC%9D%B4%EB%A6%84.&envLink=https%3A%2F%2Fwest-truth.github.io%2Fmoyami%2F&envDefaults=%7B%22SITE_NAME%22%3A%22moyami%22%7D&products=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22upstash%22%2C%22productSlug%22%3A%22upstash-kv%22%2C%22protocol%22%3A%22storage%22%7D%5D)

| 단계 | 할 일 | 입력하는 값 |
| --- | --- | --- |
| ① 가입 키 | 가이드에서 **가입 키 생성**을 누릅니다. 키가 자동으로 복사됩니다. **파일로 보관**도 눌러 두세요. | — |
| ② 배포 | **Vercel 배포 시작**을 누르고 GitHub로 로그인한 뒤, **Upstash** 저장 공간을 **Free** 요금제로 만듭니다. | `BOOTSTRAP_KEY`: ①의 키<br>`SITE_NAME`: 앱 이름 |
| ③ 가입 | 배포된 주소(`이름.vercel.app`)를 열어 **관리자 계정**을 만듭니다. | ①의 키, 아이디, 비밀번호(10자 이상) |

가입 키는 브라우저 안에서 만들어지며 어디에도 전송되지 않습니다. 가이드 페이지가 열리지 않으면 [public/deploy.html](public/deploy.html)을 내려받아 브라우저로 열어도 됩니다.

가입한 뒤 **설정 → 확장 소스 → 저장소 → 저장소 추가**에 쓸 Mangayomi JS 저장소 주소를 넣고 소스를 고르세요. 기본으로 들어 있는 저장소는 없습니다. 휴대폰에서는 브라우저 메뉴의 **홈 화면에 추가**로 앱처럼 쓸 수 있습니다.

## 사용 안내

### 다른 기기에서 이어 읽기

휴대폰과 PC에서 **같은 앱 주소에 같은 계정으로 로그인**하면 됩니다. 바로 옮겨 읽으려면 **설정 → 계정 → 지금 동기화**를 누르세요.

| 기기끼리 공유 | 기기마다 따로 |
| --- | --- |
| 최근 읽은 작품·회차, 만화 페이지·소설 읽던 위치 | 표지, 작품 본문·만화 이미지 |
| 회차 읽음·안 읽음 표시 | 글꼴·글자 크기·읽기 방식 등 리더 설정 |
| 확장 저장소 목록, 고정한 소스 | 소스 로그인·옵션, 연결 방식, 북마크·메모, 회차 제목 수정 |

- 읽는 동안의 변경은 약 2초씩 모아 저장하고, 열린 앱은 15초마다 다른 기기의 기록을 확인합니다.
- 연결이 끊겨도 변경은 기기에 남았다가 다시 연결되면 저장됩니다. 같은 기록을 동시에 고쳤다면 먼저 저장된 쪽을 따릅니다.
- 계정당 **3 MiB·3,000항목**까지 보관합니다. 누적 전송량이 아니라 현재 보관량이며, 같은 회차의 위치는 최신 값 하나만 남습니다. 한도에 닿으면 설정에 안내가 뜨고 새 기록은 기기에 보관합니다.
- 다른 기기에서 처음 열면 표지가 비어 있을 수 있습니다. 작품을 열면 소스에서 다시 받아 그 기기에 보관합니다.

### 다운로드와 캐시

**설정 → 다운로드**에서 이 기기에서만 적용되는 설정을 바꿉니다.

| 항목 | 선택지 | 설명 |
| --- | --- | --- |
| 미리 불러오기 | 켜기·끄기 (기본 켜짐) | 최근 읽기에서 탐색 목록과 이어 읽을 회차를, 읽는 동안에는 다음 회차를 준비합니다. |
| 회차 이미지 미리 받기 | 2·8·16장 (기본 8장) | 소설은 다음 회차 본문을 받습니다. |
| 목록·소스 캐시 한도 | 16·32·64·128 MiB (기본 32 MiB) | 한도를 줄이면 오래된 항목부터 지웁니다. |
| 콘텐츠 캐시 비우기 | — | 목록·소스 코드·표지·미리 받은 회차를 지웁니다. 읽기 기록·계정·설정은 남습니다. |

지금 보는 화면의 요청이 항상 먼저이고, 다른 화면으로 가면 미리 받던 작업은 멈춥니다. 데이터 절약 모드·2G 연결·숨겨진 탭에서는 미리 받지 않습니다. 회차 캐시는 잠시 보관하는 용도라 오프라인 읽기를 보장하지 않습니다.

### 원본 사이트 연결

Vercel에 배포해도 원본 사이트의 Cloudflare 인증이나 IP 차단은 자동으로 풀리지 않고, 쓸 수 있는 소스도 저장소마다 다릅니다. 막히는 소스는 **설정 → 연결**에서 **브라우저 연결 확장**을 쓰면 내 브라우저로 원본에 접속합니다. 설치 방법은 앱의 연결 설정에 있는 안내를 따르세요.

- PC Chromium 계열·Firefox용 설치 파일(ZIP)을 제공합니다.
- Android Firefox와 iPhone·iPad Safari는 확장 서명·배포 절차가 따로 필요합니다.

### 계정과 가입 키

- 처음 만든 가입 키(`BOOTSTRAP_KEY`)는 첫 관리자 가입에만 쓰입니다.
- 다른 사람은 관리자가 **설정 → 계정 → 가입 키 발급**으로 초대합니다. 24시간 동안 한 번 쓸 수 있고, 발급 화면에서 취소할 수 있습니다.
- 비밀번호 찾기(이메일 복구)는 없습니다. 관리자 비밀번호를 잊지 않도록 보관하세요.
- 비밀번호는 salt를 포함한 scrypt 해시로, 세션과 초대 키도 해시로만 저장합니다.

## 문제 해결

### “저장 공간 연결이 필요합니다”라고 나와요

계정과 읽기 기록을 보관할 Upstash Redis가 아직 연결되지 않은 상태입니다.

1. [Vercel 대시보드](https://vercel.com/dashboard)에서 내 moyami 프로젝트를 엽니다.
2. **Storage → Create Database**에서 **Upstash → Redis**를 고르고 **Free** 요금제로 만듭니다. 이미 만든 게 있다면 그것을 골라도 됩니다.
3. **Connect to Project**에서 내 프로젝트를, 환경은 **Production**을 고릅니다.
4. **Deployments**에서 가장 최근 배포의 **⋯ → Redeploy**를 누릅니다.
5. 끝나면 앱을 새로고침합니다. 가입 화면이 보이면 완료입니다.

주소와 토큰은 Vercel이 자동으로 넣어 줍니다. 화면 이름이 다르면 [Vercel 저장 공간 안내](https://vercel.com/docs/marketplace-storage)를 참고하세요.

<details>
<summary>연결했는데도 계속 나온다면</summary>

**Settings → Environment Variables**에 아래 두 쌍 중 하나가 온전히 있어야 합니다. 값을 고쳤다면 다시 배포하세요. 토큰은 비밀번호처럼 다뤄 주세요.

| 주소 | 토큰 |
| --- | --- |
| `KV_REST_API_URL` | `KV_REST_API_TOKEN` |
| `UPSTASH_REDIS_REST_URL` | `UPSTASH_REDIS_REST_TOKEN` |

</details>

### “첫 가입 키가 설정되지 않았습니다”라고 나와요

`BOOTSTRAP_KEY`가 없거나 32자보다 짧습니다. [배포 가이드](https://west-truth.github.io/moyami/)에서 키를 만들고, **Settings → Environment Variables**에 `BOOTSTRAP_KEY`로 추가한 뒤 다시 배포하세요.

### 새 버전을 배포했는데 예전 화면이 보여요

moyami는 설치형 앱이라 화면 파일을 기기에 보관하고, **앱의 탭과 창을 모두 닫았다가 다시 열 때** 새 버전으로 바꿉니다. 새로고침만으로는 바뀌지 않습니다. 휴대폰은 최근 앱 목록에서도 닫아 주세요. 한 번에 안 바뀌면 한 번 더 닫았다 엽니다.

그래도 안 되면 사이트 데이터를 지웁니다. 이 기기에만 있던 설정은 사라지지만, 동기화된 읽기 기록은 다시 로그인하면 돌아옵니다.

| 기기 | 방법 |
| --- | --- |
| PC Chrome·Edge | F12 → **Application** → **Storage** → **Clear site data** → 새로고침 |
| Android Chrome | 설정 → 사이트 설정 → 모든 사이트 → 내 앱 주소 → **삭제** |
| iPhone·iPad | 설정 → Safari → 고급 → 웹사이트 데이터 → 내 앱 주소 → 삭제. 홈 화면 앱은 지우고 다시 추가 |

## 운영하기

### 새 버전 받기

원터치 배포는 내 GitHub 계정에 이 저장소의 복사본을 만들고, Vercel은 그 복사본이 바뀔 때마다 다시 배포합니다. 새 버전은 원본 변경을 내 복사본으로 가져오면 됩니다.

```sh
git clone https://github.com/내-계정/내-저장소.git && cd 내-저장소
git remote add upstream https://github.com/west-truth/moyami.git
git pull upstream main
git push origin main   # Vercel이 자동으로 다시 배포합니다.
```

### 이름과 주소 바꾸기

- 앱 이름은 `SITE_NAME`을 바꾸고 다시 배포하면 됩니다.
- 개인 도메인은 Vercel **Settings → Domains**에서 연결합니다. 브라우저 연결 확장을 쓴다면 `APP_URL=https://내-도메인`도 추가해 다시 배포하고 확장을 다시 설치하세요. 주소가 여럿이면 `CONNECTOR_READER_ORIGINS`에 쉼표로 나열합니다.

### Vercel CLI로 배포하기

GitHub 연결 없이 이미 있는 Vercel 프로젝트에 바로 올릴 수도 있습니다. [Vercel 토큰](https://vercel.com/account/tokens)은 셸 환경변수로만 쓰고 저장소에 넣지 마세요.

```sh
export VERCEL_TOKEN=...
npx vercel link --yes --project 내-프로젝트 --scope 내-팀 --token "$VERCEL_TOKEN"
npx vercel pull --yes --environment=production --token "$VERCEL_TOKEN"
# 로컬 빌드는 운영 주소를 모르므로 직접 알려 줍니다.
APP_URL=https://내-앱.vercel.app npx vercel build --prod --token "$VERCEL_TOKEN"
npx vercel deploy --prebuilt --prod --token "$VERCEL_TOKEN"
```

`vercel pull`이 만드는 `.vercel/`과 `.env.local`은 커밋하지 마세요. 문제가 생기면 **Deployments**에서 이전 배포를 **Promote to Production**으로 되돌릴 수 있습니다.

### 예전 접근 키 방식에서 옮겨 오기

예전 moya-source-lite(접근 키 방식)를 쓰던 Vercel 프로젝트에 그대로 moyami를 배포할 수 있습니다. 주소와 Upstash 연결은 그대로 씁니다.

1. **Environment Variables**에 `BOOTSTRAP_KEY`와 `SITE_NAME`을 추가합니다.
2. `APP_ACCESS_KEY`는 지워도 됩니다. `APP_SECRET`은 로그인 서명에 계속 쓰이므로 그대로 둡니다.
3. 다시 배포하고, 각 기기에서 [예전 화면 정리](#새-버전을-배포했는데-예전-화면이-보여요)를 합니다.
4. 관리자 계정을 만들고 저장소를 다시 추가합니다. 예전 기록은 새 계정으로 옮겨지지 않습니다.

### 운영 시 주의

- 테스트용 Preview 배포에 운영 Redis를 연결하면 운영 계정을 함께 씁니다. 별도 DB를 쓰거나 `AUTH_NAMESPACE`를 다르게 지정하세요.
- `BOOTSTRAP_KEY`는 환경변수에 남겨 두세요. 바꿔도 기존 계정은 그대로입니다.

## 개발

### 로컬 실행

Node.js 22가 필요합니다.

```sh
npm ci
cp .env.example .env   # BOOTSTRAP_KEY를 채웁니다.
npm run build
node --env-file=.env --import tsx server/index.ts
```

기본 주소는 `http://127.0.0.1:4173`입니다. Redis 없이 실행하면 계정과 동기화 데이터를 `data/auth.json`에 저장하므로 이 폴더를 보관하세요. 파일 저장은 서버 하나일 때만 쓰고, 여러 대로 운영하면 Redis를 연결합니다.

Docker는 `docker compose up -d --build`로 실행하며 계정 파일은 `accounts` 볼륨에 남습니다. HTTPS 프록시 뒤에서는 `COOKIE_SECURE=1`을 설정하세요.

### 테스트

```sh
npm run build
npm test                              # REDIS_TEST_PORT=6379를 주면 실제 Redis로도 확인
export MOYA_SOURCE_BROWSER_EXECUTABLE=/path/to/chromium
npm run test:auth
npm run test:sync
npm run test:browser
npm run test:pwa
APP_URL=https://reader.example.com npm run build:hosting   # Vercel과 같은 빌드
```

`npm run test:connector`는 443 포트를 열어야 해서 관리자 권한이 필요합니다. 배포 가이드의 원본은 `public/deploy.html`이며, `npm run build:client`가 GitHub Pages용 `docs/index.html`로 복사합니다.

## 라이선스

Apache-2.0. [LICENSE](LICENSE), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), [Moya UI 출처](vendor/moya-ui/README.md)를 확인하세요. 확장 소스와 원본 콘텐츠의 권리·이용 조건은 각 제공자에게 있습니다.
