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

원클릭 배포는 처음 설치하기 간편하지만, 이후 업데이트는 코드 병합이나 배포 권한 문제로 번거로울 수 있습니다.

[![Vercel로 배포](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fwest-truth%2Fmoyami&env=BOOTSTRAP_KEY%2CSITE_NAME&envDescription=BOOTSTRAP_KEY%3A%20%EB%B0%B0%ED%8F%AC%20%EA%B0%80%EC%9D%B4%EB%93%9C%EC%97%90%EC%84%9C%20%EC%83%9D%EC%84%B1%ED%95%9C%20%EC%B2%AB%20%EA%B0%80%EC%9E%85%20%ED%82%A4%20%2832%EC%9E%90%20%EC%9D%B4%EC%83%81%29.%20SITE_NAME%3A%20%EC%9B%90%ED%95%98%EB%8A%94%20%EC%95%B1%20%ED%91%9C%EC%8B%9C%20%EC%9D%B4%EB%A6%84.&envLink=https%3A%2F%2Fwest-truth.github.io%2Fmoyami%2F&envDefaults=%7B%22SITE_NAME%22%3A%22moyami%22%7D&products=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22upstash%22%2C%22productSlug%22%3A%22upstash-kv%22%2C%22protocol%22%3A%22storage%22%7D%5D)

| 단계 | 할 일 | 입력하는 값 |
| --- | --- | --- |
| ① 가입 키 | 가이드에서 **가입 키 생성**을 누릅니다. 키가 자동으로 복사됩니다. **파일로 보관**도 눌러 두세요. | — |
| ② 배포 | **Vercel 배포 시작**을 누르고 GitHub로 로그인한 뒤, **Upstash** 저장 공간을 **Free** 요금제로 만듭니다. Free가 안 보이면 아래 [Fork로 배포하기](#free가-안-보일-때-fork로-배포하기)를 따르세요. | `BOOTSTRAP_KEY`: ①의 키<br>`SITE_NAME`: 앱 이름 |
| ③ 가입 | 배포된 주소(`이름.vercel.app`)를 열어 **관리자 계정**을 만듭니다. | ①의 키, 아이디, 비밀번호(10자 이상) |

가입 키는 브라우저 안에서 만들어지며 어디에도 전송되지 않습니다. 가이드 페이지가 열리지 않으면 [public/deploy.html](public/deploy.html)을 내려받아 브라우저로 열어도 됩니다.

### Free가 안 보일 때: Fork로 배포하기

이미 Upstash 저장 공간을 만든 적 있는 계정에서는 ②의 요금제 목록에 Free 없이 **Pay as you go**나 **Fixed** 같은 유료 요금제만 보일 수 있습니다. Pay as you go는 Free의 무료 사용량이 따로 남지 않고 처음부터 사용량만큼 요금이 붙으니 고르지 말고, 배포 창을 닫은 뒤 아래처럼 배포하세요. 배포 가이드의 **Free가 안 보일 때** 항목에서도 같은 순서를 따라 할 수 있습니다.

| 단계 | 할 일 | 입력·복사하는 값 |
| --- | --- | --- |
| A 저장 공간 | [Upstash 콘솔](https://console.upstash.com/redis)에서 **Create Database**를 누르고 요금제를 **Free**로 만듭니다. 지역은 서울이 없으면 도쿄를 고릅니다. **REST API** 항목에서 주소와 토큰을 복사합니다. | `UPSTASH_REDIS_REST_URL`(`https://`로 시작)<br>`UPSTASH_REDIS_REST_TOKEN` |
| B Fork | [moyami Fork하기](https://github.com/west-truth/moyami/fork)에서 **Create fork**를 누릅니다. | — |
| C 배포 | [Vercel](https://vercel.com/new)에서 B의 저장소를 **Import**하고, **Environment Variables**에 네 값을 넣은 뒤 **Deploy**를 누릅니다. 빌드 설정은 그대로 둡니다. | `BOOTSTRAP_KEY`: ①의 키<br>`SITE_NAME`: 앱 이름<br>A의 주소와 토큰 |

배포가 끝나면 ③처럼 가입합니다. 가이드의 **환경변수 한꺼번에 복사**를 누르면 네 값을 Vercel의 첫 **Key** 칸에 한 번에 붙여 넣을 수 있습니다.

가입한 뒤 **설정 → 확장 소스 → 저장소 → 저장소 추가**에 쓸 Mangayomi JS 저장소 주소를 넣고 소스를 고르세요. 기본으로 들어 있는 저장소는 없습니다. 휴대폰에서는 브라우저 메뉴의 **홈 화면에 추가**로 앱처럼 쓸 수 있습니다.

## 사용 안내

### 세로 모드에서 회차 넘기기

- **PC 스크롤**: 회차 끝에서 잠시 멈춘 뒤 다시 아래로 스크롤하면 다음 화로 넘어갑니다.
- **모바일 터치**: 끝까지 읽고 손을 뗀 뒤 다시 위로 쓸어 올리세요. 끝에 도달한 스와이프와 그 관성으로는 다음 화로 넘어가지 않습니다.
- **방향키·Page Up/Down·Space**: 본문 안에서는 화면 단위로 이동합니다. 맨 아래에서 다음 방향 키를 새로 누르면 다음 화로, 맨 위에서 이전 방향 키를 새로 누르면 이전 화의 끝으로 이동합니다. 키를 누르고 있어도 회차가 연속으로 넘어가지는 않습니다.

세로와 세로 · 이음새 없음 모드에 모두 적용됩니다. 하단의 이전 화·다음 화 버튼으로도 이동할 수 있습니다.

### 시작 화면과 읽은 위치 초기화

- **설정 → 화면 → 시작 화면**에서 최근 읽기(기본값) 또는 등록한 소스의 탐색 화면을 고를 수 있습니다. 이 기기에만 적용됩니다.
- 작품 상세의 **읽은 위치 초기화**는 확인 후 해당 작품의 이어 읽기 위치·진행률·읽음 표시를 지우고 동기화합니다. 북마크·메모·수정한 회차 제목은 유지됩니다.

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
| 만화 이미지 직접 받기 | 켜기·끄기 (기본 켜짐) | 가능한 본문 이미지를 원본 사이트에서 기기로 직접 받아 배포 서버의 전송량을 줄입니다. 실패하면 서버 중계로 전환합니다. |
| 미리 불러오기 | 켜기·끄기 (기본 켜짐) | 최근 읽기에서 탐색 목록과 이어 읽을 회차를, 읽는 동안에는 다음 회차를 준비합니다. |
| 회차 이미지 미리 받기 | 2·8·16장 (기본 8장) | 소설은 다음 회차 본문을 받습니다. |
| 목록·소스 캐시 한도 | 16·32·64·128 MiB (기본 32 MiB) | 한도를 줄이면 오래된 항목부터 지웁니다. |
| 콘텐츠 캐시 비우기 | — | 목록·소스 코드·표지·미리 받은 회차를 지웁니다. 읽기 기록·계정·설정은 남습니다. |

지금 보는 화면의 요청이 항상 먼저이고, 다른 화면으로 가면 미리 받던 작업은 멈춥니다. 데이터 절약 모드·2G 연결·숨겨진 탭에서는 미리 받지 않습니다. 회차 캐시는 잠시 보관하는 용도라 오프라인 읽기를 보장하지 않습니다.

직접 받기는 브라우저 연결 확장 없이도 동작합니다. 서버는 로그인과 이미지 주소를 확인한 뒤 원본 주소로 연결하며, 이미지 본문은 기기가 받습니다. 직접 받기가 실패하거나 5초 안에 끝나지 않으면 기존 서버 중계로 전환합니다. 쿠키·인증 헤더 등 추가 헤더가 필요한 이미지, 서버의 별도 외부 프록시를 쓰는 경우, 표지는 기존 중계를 유지합니다. 자동 여백 자르기는 이미지 분석을 위해 서버로 다시 받을 수 있습니다.

무료 사용량을 무제한으로 만드는 기능은 아닙니다. 직접 받기를 막는 소스에서는 이미지 중계량이 계속 발생하며, 직접 받기에 성공해도 서버의 인증·주소 확인 요청과 동기화 사용량은 남습니다. Vercel의 **Usage → Fast Origin Transfer**에서 실제 절감량을 확인하세요.

**설정 → 다운로드 → 이미지 전송 진단 (디버그)**은 기본으로 꺼져 있습니다. 직접 켠 뒤 새 회차를 읽고 돌아오면 직접 경로·서버 중계·연결 확장 완료 횟수와 중계 전환 이유를 확인할 수 있습니다.

- 끄거나 새로고침하면 기록이 지워지고 진단도 꺼집니다.
- 해당 탭의 회차 이미지와 미리 받기·캐시·재요청만 집계합니다. 표지와 전체 계정 사용량은 포함하지 않습니다.
- 최근 요청은 최대 40건이며 주소·인증 정보·작품명은 보관하지 않습니다.
- 이미지 크기를 알 수 없는 경우가 있어 절감 MB나 청구량으로 환산하지 않습니다.

### 원본 사이트 연결

Vercel에 배포해도 원본 사이트의 Cloudflare 인증이나 IP 차단은 자동으로 풀리지 않고, 쓸 수 있는 소스도 저장소마다 다릅니다. 막히는 소스는 **설정 → 연결**에서 **브라우저 연결 확장**을 쓰면 내 브라우저로 원본에 접속합니다. 설치 방법은 앱의 연결 설정에 있는 안내를 따르세요.

- PC Chromium 계열·Firefox용 설치 파일(ZIP)을 제공합니다.
- Android Firefox와 iPhone·iPad Safari는 확장 서명·배포 절차가 따로 필요합니다.

소스가 HTTP로 받은 HTML·JSON에서 회차 정보를 읽는 방식은 지원합니다. 페이지의 JavaScript를 실행하는 WebView 호출은 지원하지 않습니다. 브라우저 연결 확장은 HTTP 요청을 내 브라우저로 보내는 기능이며, WebView 실행 기능을 추가하지는 않습니다. 앱에 특정 사이트 전용 수집 로직이나 기본 허용 사이트 목록은 포함하지 않습니다.

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

주소와 토큰은 Vercel이 자동으로 넣어 줍니다. Free가 안 보이면 [Upstash 콘솔](https://console.upstash.com/redis)에서 Free 저장 공간을 만들고, **Settings → Environment Variables**에 `UPSTASH_REDIS_REST_URL`과 `UPSTASH_REDIS_REST_TOKEN`을 직접 넣은 뒤 다시 배포하세요. 화면 이름이 다르면 [Vercel 저장 공간 안내](https://vercel.com/docs/marketplace-storage)를 참고하세요.

<details>
<summary>연결했는데도 계속 나온다면</summary>

**Settings → Environment Variables**에 아래 두 쌍 중 하나가 온전히 있어야 합니다. Vercel의 저장 공간 연결은 `KV_REST_API_*`를, Upstash 콘솔에서 복사해 넣은 값은 `UPSTASH_REDIS_REST_*`를 씁니다. 주소는 `redis://`가 아니라 `https://`로 시작하는 REST 주소여야 합니다. 값을 고쳤다면 다시 배포하세요. 토큰은 비밀번호처럼 다뤄 주세요.

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

업데이트는 **내 저장소에 최신 코드 가져오기 → 그 코드를 운영 배포 → 앱의 새 버전 적용** 순서입니다. Vercel의 **Redeploy**만 누르면 선택한 기존 배포의 코드를 다시 빌드하므로 원본의 새 커밋을 가져오지 않습니다.

#### 1. 내 저장소의 main 업데이트

최신 기능은 원본의 **main** 브랜치에 올라옵니다. 다른 작업 브랜치는 이전 코드일 수 있습니다.

- **Fork로 배포했다면**: 내 GitHub 저장소에서 브랜치를 **main**으로 선택하고 **Sync fork → Update branch**를 누릅니다. 충돌 안내가 나오면 먼저 충돌을 해결해야 합니다.
- **원클릭으로 만든 복사본이라면**: Sync fork가 없습니다. 아래 명령으로 원본 변경을 병합합니다. 처음에는 커밋 이력이 달라 `--allow-unrelated-histories`가 필요할 수 있습니다. 같은 파일을 양쪽에서 추가한 것으로 처리되어 충돌할 수도 있습니다.

아래 예시는 내 저장소의 운영 브랜치가 `main`인 경우입니다. 주소를 바꾸어 새 폴더에서 실행합니다.

```sh
git clone --branch main https://github.com/내-계정/내-저장소.git
cd 내-저장소
git remote add upstream https://github.com/west-truth/moyami.git
git fetch upstream
git merge --no-edit --allow-unrelated-histories upstream/main
```

병합이 성공했는지 `git status`로 확인한 뒤 `git push origin main`을 실행합니다. 충돌이 있으면 파일을 검토·수정하고 `git add`와 `git commit`으로 병합을 마쳐야 합니다. 병합을 취소하려면 `git merge --abort`를 사용합니다. 이미 upstream을 등록한 폴더에서는 clone과 remote add를 반복하지 않고 fetch부터 실행합니다.

#### 2. 운영 배포 확인

Vercel에서 연결된 **GitHub 저장소**와 **Production Branch**가 방금 업데이트한 저장소의 `main`인지 확인합니다. `ux/usability-pass` 같은 다른 브랜치를 배포하면 main의 새 기능이 반영되지 않습니다.

자동 배포가 생성되면 배포 상세에서 **소스 브랜치·커밋**, **Ready**, **Production** 여부를 확인합니다. 실패했거나 Preview로만 배포됐다면 운영 주소에는 적용되지 않습니다. 자동 배포가 없으면 Git 연결과 배포 오류를 확인하세요. 예전 배포의 Redeploy로 대신하지 마세요.

##### Deployment Blocked: 커밋 작성자 권한으로 막힌 경우

배포 상세에 `The deployment was blocked because the commit author did not have contributing access`가 표시되면 아래 절차를 따르세요. Vercel Hobby의 비공개 저장소는 커밋 작성자가 해당 Vercel 프로젝트를 소유한 Hobby 계정과 연결되어 있어야 합니다. 원본 코드를 가져와도 작성자는 원본 개발자로 남을 수 있습니다. [Vercel 공식 안내](https://vercel.com/docs/deployments/troubleshoot-project-collaboration)

**먼저 1단계로 내 저장소의 main에 최신 코드를 가져온 상태여야 합니다.** 아래 작업은 배포를 다시 요청하는 절차이며 최신 코드를 가져오지는 않습니다.

1. **Vercel에 연결한 본인 GitHub 계정**으로 로그인하고, 내 저장소의 **main → README.md → 연필(Edit)**을 엽니다.
2. 파일 맨 아래에 `<!-- deployment check -->`를 추가합니다. 이미 있으면 주석 안에 날짜 등을 붙여 내용을 바꿉니다. 이 주석은 README 화면에 표시되지 않습니다.
3. **Commit changes**에서 **main에 직접 커밋**합니다. 본인 명의의 새 커밋이 만들어집니다.
4. Vercel **Deployments**에서 방금 만든 커밋의 **새 배포**가 **Ready · Production**인지 확인합니다. 이전에 막힌 배포의 Redeploy를 누르는 것과는 다릅니다.

기존 프로젝트·주소·환경변수·Upstash DB를 그대로 사용할 수 있습니다. 같은 작성자 오류가 계속되면 Vercel **Account Settings → Login Connections**에 커밋한 GitHub 계정이 연결됐는지 확인하세요. 이후 원본 업데이트에서도 같은 제한이 생길 수 있습니다.

#### 3. 앱에 새 화면 적용

운영 주소를 시크릿 창에서 열어 새 화면인지 먼저 확인합니다. 시크릿 창에는 새 화면이 보이면 기존 앱의 캐시 문제일 수 있습니다. 기존 앱을 열어 업데이트 안내를 확인한 뒤 **해당 주소의 브라우저 탭과 설치형 앱 창을 모두 닫고 다시 엽니다**. 새로고침만으로는 대기 중인 업데이트가 적용되지 않을 수 있습니다.

사이트 데이터 삭제는 마지막 수단입니다. 삭제하면 동기화되지 않은 기록과 기기에만 저장된 북마크·메모·설정이 사라질 수 있습니다.

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

`npm run test:connector`는 Chromium과 로컬 HTTPS 테스트 서버로 브라우저 연결 확장을 검증합니다. 배포 가이드의 원본은 `public/deploy.html`이며, `npm run build:client`가 GitHub Pages용 `docs/index.html`로 복사합니다.

## 면책 조항

moyami는 사용자가 직접 배포해 쓰는 리더 소프트웨어입니다.

- **콘텐츠와 저장소를 제공하지 않습니다.** moyami에는 기본 확장 저장소가 없으며, 이 프로젝트는 만화·소설 등 어떤 콘텐츠도 호스팅·배포·추천하지 않습니다. 어떤 확장 저장소와 소스를 등록하고 어떤 콘텐츠에 접근할지는 전적으로 사용자가 정합니다.
- **법령과 이용 약관은 사용자가 지켜야 합니다.** 저작권법을 비롯한 거주 국가의 법령과 원본 사이트의 이용 약관을 지킬 책임은 사용자에게 있습니다. 브라우저 연결 확장이나 프록시로 원본 사이트에 접속할 때도 같습니다. 권리자가 허락하지 않은 콘텐츠에 접근하거나 이를 공유하는 데 moyami를 쓰지 마세요.
- **각 배포본은 배포한 사람이 운영합니다.** 제작자는 사용자가 배포한 앱을 운영·관리·감시하지 않으며, 그 앱에 저장된 계정과 읽기 기록에 접근할 수 없습니다. 초대한 다른 사용자의 이용을 포함해 배포본에서 일어나는 일은 그 배포본의 운영자가 책임집니다.
- **외부 서비스의 요금과 약관은 각 서비스와 사용자 사이의 일입니다.** Vercel, Upstash, GitHub 등의 요금, 사용량 제한, 계정 조치에 대해 제작자는 책임지지 않습니다. 유료 요금제를 고르면 요금이 나올 수 있으니 요금제를 직접 확인하세요.
- **보증과 책임의 제한**: moyami는 [Apache-2.0 라이선스](LICENSE) 제7조·제8조에 따라 “있는 그대로(AS IS)” 제공됩니다. 적용 법령에서 요구하거나 서면으로 별도 합의한 경우를 제외하고, 제작자는 보증을 제공하지 않으며 라이선스가 정한 범위에서 손해에 대한 책임을 제한합니다. 이 안내는 법령상 배제할 수 없는 책임까지 면제한다는 뜻이 아닙니다.
- **권리 침해 문의**: 이 저장소의 코드나 문서가 권리를 침해한다고 생각되면 이슈로 알려 주세요. 개별 배포본이나 확장 소스에 관한 문의는 해당 운영자나 제공자에게 해 주세요.

## 라이선스

Apache-2.0. [LICENSE](LICENSE), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), [Moya UI 출처](vendor/moya-ui/README.md)를 확인하세요. 확장 소스와 원본 콘텐츠의 권리·이용 조건은 각 제공자에게 있습니다.
