# Claude Prompt Gallery

Claude Code 세션 로그와 웹 채팅 기록을 큐레이션하는 정적 웹사이트.

## 로컬 실행

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # dist/ 에 정적 파일 생성
npm run preview    # 빌드 결과물 미리보기
```

## 새 프롬프트 추가

### 방법 1 — JSON 파일 직접 작성

`data/prompts/` 폴더에 새 `.json` 파일을 생성합니다.

```json
{
  "id": "unique-slug",
  "title": "프롬프트 제목",
  "source": "web",
  "date": "2025-07-01",
  "tags": ["태그1", "태그2"],
  "summary": "한 줄 요약 (카드에 표시됨)",
  "prompt": "# 마크다운 형식의 프롬프트",
  "response": "# 마크다운 형식의 응답 (선택)",
  "sessionRef": "세션 파일 경로 (선택)"
}
```

`source` 값: `"web"` (웹 채팅) 또는 `"code"` (Claude Code)

### 방법 2 — 변환 스크립트

**Claude Code 세션 변환** (`.jsonl` → JSON)

```bash
node scripts/convert-code-session.mjs ~/.claude/projects/<project>/<session>.jsonl
# 옵션:
# --output data/prompts    # 저장 경로 (기본값)
# --tags python,cli        # 추가 태그
```

**웹 채팅 export 변환** (JSON → JSON)

```bash
node scripts/convert-web-chat.mjs ~/Downloads/claude_export.json
# 옵션:
# --output data/prompts
# --tags react,리팩토링
```

## 로컬 관리자 도구 사용법

정적 사이트 특성상 배포된 사이트에는 삭제·가져오기 기능을 넣을 수 없습니다. 로컬에서만 동작하는 관리자 서버를 제공합니다.

```bash
npm run admin   # http://localhost:3001 에서 관리자 UI 실행
```

브라우저에서 `http://localhost:3001` 을 열면 두 가지 탭이 나타납니다.

### 카드 관리 탭

- `data/prompts/` 내 모든 JSON 카드를 제목·소스·날짜·턴수 순으로 나열합니다.
- 각 카드 오른쪽의 **삭제** 버튼을 클릭하면 확인 팝업이 뜨고, 확인 시 파일이 즉시 삭제됩니다.
- **새로고침** 버튼으로 파일 목록을 다시 불러올 수 있습니다.

### 대화 가져오기 탭

1. **파일 선택** 버튼으로 Claude export 파일을 선택합니다.
   - 지원 포맷: `conversations.json` (웹 export), `.jsonl` (Claude Code 세션)
2. 파일을 읽어 유효한 대화 목록을 체크박스 형태로 표시합니다.
   - 이미 `data/prompts/`에 같은 ID가 있으면 **중복** 표시됩니다 (가져오면 덮어씁니다).
3. 원하는 대화를 체크한 뒤 **N개 대화 가져오기** 버튼을 클릭합니다.
4. 선택한 대화가 `data/prompts/web-XXXXXXXX.json` 형식으로 저장됩니다.

> **참고**: 관리자 서버는 `127.0.0.1`(로컬호스트)에만 바인딩되며 Astro 빌드(`dist/`)에 포함되지 않습니다. Vercel 배포 시 이 서버는 실행되지 않습니다.
>
> 포트를 변경하려면 `ADMIN_PORT=3002 npm run admin` 처럼 환경 변수를 사용합니다.

## Vercel 배포

### 방법 A — Vercel 웹 대시보드 (권장, 가장 빠름)

1. GitHub에 저장소를 생성하고 push합니다.
2. [vercel.com/new](https://vercel.com/new) 에서 저장소를 import합니다.
3. Vercel이 Astro 프레임워크를 자동 감지합니다. 설정 변경 없이 **Deploy** 클릭.
4. 이후 `main` push마다 자동 배포, PR마다 프리뷰 URL이 생성됩니다.

### 방법 B — GitHub Actions 자동화

`.github/workflows/deploy.yml`이 포함되어 있습니다. 아래 시크릿을 저장소에 추가하세요.

```
VERCEL_TOKEN       # Vercel 계정 설정 → Tokens에서 생성
VERCEL_ORG_ID      # vercel.json 또는 .vercel/project.json에서 확인
VERCEL_PROJECT_ID  # 위 동일
```

시크릿 추가 후 `main` push → 프로덕션 배포, PR → 프리뷰 배포가 자동으로 실행됩니다.

### 커스텀 도메인

Vercel 프로젝트 Settings → Domains에서 추가합니다. `astro.config.mjs` 수정 불필요.

## 기술 스택

- [Astro 4](https://astro.build) — SSG 프레임워크
- [Tailwind CSS 3](https://tailwindcss.com) — 스타일링
- [Fuse.js](https://www.fusejs.io) — 클라이언트 사이드 퍼지 검색
- [marked](https://marked.js.org) — 마크다운 렌더링
- [Vercel](https://vercel.com) — 자동 배포 (프리뷰 URL 포함)
