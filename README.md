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
