# OpenClaw Custom — Orchestrator Fork

## 이게 뭔가요?

[OpenClaw](https://github.com/openclaw/openclaw)는 개인용 AI 어시스턴트입니다.
이 포크는 거기에 **"팀장 AI"** 개념을 얹은 것입니다.

**순정 OpenClaw**: AI가 혼자서 모든 걸 합니다 — 코드 읽기, 웹 검색, 파일 수정까지 전부 하나의 AI가 처리.

**이 포크**: AI가 "팀장"처럼 동작합니다 — 직접 일하지 않고, 전문가 AI들에게 일을 나눠주고, 결과를 종합해서 보고합니다.

```
순정 OpenClaw:    사용자 → AI (혼자 다 함) → 답변

이 포크:          사용자 → 팀장 AI (Sisyphus)
                              ├→ 코드 전문가 (Explorer)에게 "소스코드 찾아봐"
                              ├→ 문서 전문가 (Librarian)에게 "공식 문서 확인해"
                              └→ 설계 전문가 (Oracle)에게 "아키텍처 분석해"
                              ←── 결과 종합해서 답변
```

> Upstream: [openclaw/openclaw](https://github.com/openclaw/openclaw) · 포크 시점: `17578d7`

---

## 왜 만들었나요?

순정 OpenClaw에서도 서브에이전트(`sessions_spawn`)를 쓸 수 있지만, **실제로 오케스트레이터 패턴을 구현하려 하면 벽에 부딪힙니다**:

### 문제 1: 팀장한테 도구를 빼면 부하도 못 씀

팀장 AI가 직접 코드를 읽지 못하게 도구(`read`, `exec`)를 빼면,
부하 AI들도 똑같이 그 도구를 못 씁니다.

> 왜? 순정 OpenClaw는 서브에이전트를 만들 때 **부모의 도구 권한을 그대로 복사**하기 때문.
> 팀장이 `read` 못 쓰면 → 부하도 `read` 못 씀 → 코드 분석 불가.

### 문제 2: 팀장한테 도구를 주면 위임 안 함

반대로 팀장 AI에게 `read`, `exec`를 주면?
팀장이 부하한테 일을 안 시키고 **자기가 직접 다 해버립니다**.

> 프롬프트에 "절대 직접 하지 마" 라고 아무리 써도 무시함.
> 실제 테스트: read 66회, exec 59회 직접 사용, sessions_spawn은 2회뿐.

### 이 포크의 해결책

**소스 코드를 딱 한 줄 고쳤습니다** — 서브에이전트를 만들 때, 팀장의 도구 권한 대신 **부하 자신의 도구 권한**을 적용하도록.

```
변경 전: 부하 AI 생성 → 팀장 권한 복사 (팀장이 read 없으면 부하도 없음)
변경 후: 부하 AI 생성 → 부하 자신의 권한 사용 (팀장과 무관하게 read 사용 가능)
```

이 한 줄 덕분에:

- **팀장**: 위임 도구만 가짐 (`sessions_spawn`) → 직접 작업 불가, 위임 강제
- **부하들**: 각자의 설정에 따른 도구 사용 가능 → 코드 읽기, 웹 검색 등 자유롭게

---

## 아키텍처

```
┌─────────────────────────────────────────────────┐
│  사용자 질문                                      │
└──────────────────┬──────────────────────────────┘
                   ▼
┌──────────────────────────────────────────────────┐
│  Main (Sisyphus) — 팀장                          │
│  모델: claude-opus-4                             │
│  도구: sessions_spawn, subagents만 보유          │
│  역할: 위임 판단 → 서브에이전트 스폰 → 결과 종합  │
└──┬───────────────┬───────────────┬───────────────┘
   │               │               │
   ▼               ▼               ▼
┌────────┐  ┌───────────┐  ┌───────────┐
│Explorer│  │ Librarian │  │  Oracle   │
│sonnet-4│  │ sonnet-4  │  │ codex-5.3 │
│코드검색 │  │ 외부문서   │  │ 아키텍처  │
│read,exec│  │web_search │  │ read only │
└────────┘  └───────────┘  └───────────┘
   │               │               │
   └───────────────┴───────────────┘
                   │ auto-announce (자동 보고)
                   ▼
          팀장이 결과 종합 → 사용자에게 전달
```

---

## 소스 코드 변경 상세

변경은 **3파일, 약 15줄** — upstream과 충돌 가능성 거의 없음.

### 핵심: `subagents.defaultAgentId` 옵션 추가

| 파일                                     | 무슨 변경?                                  |
| ---------------------------------------- | ------------------------------------------- |
| `src/config/types.agents.ts`             | 설정에 `defaultAgentId` 옵션 타입 추가      |
| `src/config/zod-schema.agent-runtime.ts` | 설정 파일 검증에 `defaultAgentId` 필드 추가 |
| `src/agents/subagent-spawn.ts`           | 서브에이전트 생성 시 fallback 로직 변경     |

```typescript
// 변경 전 (순정)
const targetAgentId = requestedAgentId ?? requesterAgentId;
// → 모델이 agentId를 안 넘기면 "main"으로 fallback → 팀장 권한 상속

// 변경 후 (이 포크)
const targetAgentId = requestedAgentId ?? configuredDefaultAgentId ?? requesterAgentId;
// → 모델이 agentId를 안 넘기면 설정된 기본 에이전트(예: "explore")로 fallback
// → 부하 자신의 권한 사용
```

---

## 세팅 가이드

### 1. 클론 및 빌드

```bash
git clone https://github.com/jangpago/openclaw.git openclaw-custom
cd openclaw-custom
pnpm install
pnpm build
```

### 2. 설정 파일 작성

`~/.openclaw/openclaw.json`에 에이전트를 정의합니다. 아래는 기본 템플릿:

```jsonc
{
  "agents": {
    "defaults": {
      "model": { "primary": "anthropic/claude-opus-4-6" },
      "subagents": {
        "maxConcurrent": 8,
        "maxSpawnDepth": 2,
        "maxChildrenPerAgent": 10,
        "runTimeoutSeconds": 300,
        "announceTimeoutMs": 120000,
      },
    },
    "list": [
      {
        // 팀장 — 위임만 함, 직접 작업 안 함
        "id": "main",
        "default": true,
        "name": "Sisyphus",
        "model": { "primary": "anthropic/claude-opus-4-6" },
        "subagents": {
          "allowAgents": ["oracle", "librarian", "explore"],
          "defaultAgentId": "explore",
        },
        "tools": {
          "allow": [
            "sessions_spawn",
            "subagents",
            "sessions_list",
            "sessions_history",
            "session_status",
          ],
        },
      },
      {
        // 설계 전문가 — 읽기만 가능, 수정 불가
        "id": "oracle",
        "name": "Oracle",
        "model": {
          "primary": "openai/codex-5.3",
          "fallbacks": ["anthropic/claude-opus-4-6"],
        },
        "tools": {
          "profile": "coding",
          "deny": [
            "write",
            "edit",
            "apply_patch",
            "exec",
            "process",
            "message",
            "sessions_spawn",
            "subagents",
          ],
        },
      },
      {
        // 문서 전문가 — 웹 검색 가능
        "id": "librarian",
        "name": "Librarian",
        "model": {
          "primary": "anthropic/claude-sonnet-4-20250514",
          "fallbacks": ["anthropic/claude-opus-4-6"],
        },
        "tools": {
          "profile": "coding",
          "alsoAllow": ["web_search", "web_fetch"],
          "deny": [
            "write",
            "edit",
            "apply_patch",
            "exec",
            "process",
            "message",
            "sessions_spawn",
            "subagents",
          ],
        },
      },
      {
        // 코드 전문가 — 소스 읽기 + 명령어 실행 가능
        "id": "explore",
        "name": "Explorer",
        "model": {
          "primary": "anthropic/claude-sonnet-4-20250514",
          "fallbacks": ["anthropic/claude-haiku-3.5-20250512"],
        },
        "tools": {
          "profile": "coding",
          "deny": [
            "write",
            "edit",
            "apply_patch",
            "process",
            "message",
            "sessions_spawn",
            "subagents",
          ],
        },
      },
    ],
  },
  "tools": {
    "agentToAgent": { "enabled": true, "allow": ["oracle", "librarian", "explore"] },
    "sessions": { "visibility": "tree" },
    "web": {
      "search": { "enabled": true },
      "fetch": { "enabled": true },
    },
  },
  "gateway": {
    "mode": "local",
    "bind": "loopback",
  },
}
```

### 3. 팀장 행동 규칙 작성

`~/.openclaw/workspace/AGENTS.md` 파일을 만드세요.
이 파일이 팀장 AI에게 "너는 직접 일하지 말고 부하한테 시켜" 라고 알려주는 역할:

```markdown
# HARD RULE: You are an ORCHESTRATOR, not a worker.

**You MUST delegate using `sessions_spawn`. You MUST NOT do research or analysis yourself.**

When a user asks a question that requires ANY of the following, you MUST spawn a sub-agent:

- Reading or searching code → spawn `explore` agent
- Looking up documentation, APIs, or external info → spawn `librarian` agent
- Architecture analysis, debugging, or deep reasoning → spawn `oracle` agent

**The ONLY time you may answer directly** is for trivial conversational replies.
```

### 4. 인증 및 실행

```bash
# 인증 (처음 한 번)
pnpm openclaw login

# 게이트웨이 실행
pnpm openclaw gateway run
```

## 브라우저에서 `http://localhost:18789` 접속.

## 모델 갈아끼기

### 에이전트별 모델 변경

`openclaw.json`에서 각 에이전트의 `model` 필드를 바꾸면 됩니다.

```jsonc
{
  "id": "oracle",
  "model": {
    "primary": "openai/o3", // 기본 사용 모델
    "fallbacks": ["anthropic/claude-opus-4-6"], // primary가 안 될 때 대체
  },
}
```

모델 ID는 `{프로바이더}/{모델이름}` 형식:

| 프로바이더  | 모델 예시                                                                                                |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| `anthropic` | `anthropic/claude-opus-4-6`, `anthropic/claude-sonnet-4-20250514`, `anthropic/claude-haiku-3.5-20250512` |
| `openai`    | `openai/gpt-4.1`, `openai/o3`, `openai/codex-5.3`                                                        |
| `google`    | `google/gemini-2.5-pro`, `google/gemini-2.5-flash`                                                       |

### 예시: 비용 아끼기

비싼 모델은 꼭 필요한 곳에만, 단순 작업에는 저렴한 모델:

```jsonc
{ "id": "main",      "model": { "primary": "anthropic/claude-opus-4-6" } }      // 종합은 똑똑하게
{ "id": "oracle",    "model": { "primary": "openai/codex-5.3" } }               // 분석은 최고급
{ "id": "librarian", "model": { "primary": "anthropic/claude-sonnet-4-20250514" } }  // 검색은 중간
{ "id": "explore",   "model": { "primary": "anthropic/claude-haiku-3.5-20250512" } } // 코드 찾기는 저렴하게
```

### 예시: 전부 OpenAI로

```jsonc
{ "id": "main",      "model": { "primary": "openai/o3" } }
{ "id": "oracle",    "model": { "primary": "openai/o3" } }
{ "id": "librarian", "model": { "primary": "openai/gpt-4.1" } }
{ "id": "explore",   "model": { "primary": "openai/gpt-4.1-mini" } }
```

### Thinking 레벨 (사고 깊이)

서브에이전트를 스폰할 때 얼마나 깊이 생각할지 조절 가능:

| 레벨     | 의미        | 비용 | 언제 쓰나             |
| -------- | ----------- | ---- | --------------------- |
| `none`   | 생각 안 함  | 최저 | 단순한 검색           |
| `low`    | 가볍게 생각 | 낮음 | 코드 찾기             |
| `medium` | 보통        | 보통 | 문서 요약             |
| `high`   | 깊이 생각   | 높음 | 복잡한 분석           |
| `xhigh`  | 최대한 생각 | 최고 | 아키텍처 설계, 디버깅 |

---

## 에이전트 추가하기

새 전문가를 만들고 싶으면 `openclaw.json`에 추가하면 됩니다.

예: **Writer** (코드 작성 전문가) 추가

```jsonc
// 1. agents.list에 추가
{
  "id": "writer",
  "name": "Writer",
  "model": { "primary": "anthropic/claude-opus-4-6" },
  "tools": {
    "profile": "coding",
    "alsoAllow": ["write", "edit"],
    "deny": ["exec", "process", "message", "sessions_spawn", "subagents"]
  }
}

// 2. 팀장의 allowAgents에 추가
{ "id": "main", "subagents": { "allowAgents": ["oracle", "librarian", "explore", "writer"] } }
```

---

## 도구 정책 이해하기

각 에이전트가 뭘 할 수 있고 뭘 못 하는지는 `tools` 블록으로 정합니다.

| 설정        | 의미                               | 예시                              |
| ----------- | ---------------------------------- | --------------------------------- |
| `profile`   | 기본 도구 묶음                     | `"minimal"`, `"coding"`, `"full"` |
| `allow`     | **이것만** 허용 (나머지 전부 차단) | `["sessions_spawn", "subagents"]` |
| `alsoAllow` | profile 도구에 **추가**로 허용     | `["web_search"]`                  |
| `deny`      | 이것만 **차단** (나머지는 허용)    | `["write", "exec"]`               |

- `allow`를 쓰면 `profile`은 무시됨 (allow가 우선)
- `alsoAllow`는 `profile`과 함께 써야 의미 있음
- `deny`는 마지막에 적용 — 다른 설정으로 허용되어도 deny에 있으면 차단

---

## Upstream 동기화

원본 OpenClaw에 업데이트가 있으면:

```bash
git fetch origin                    # 원본 최신 가져오기
git rebase origin/main              # 내 변경 위에 올리기
pnpm install && pnpm build          # 다시 빌드
```

소스 변경이 3파일, 15줄뿐이라 충돌 가능성 거의 없습니다.

---

## License

원본 [MIT License](LICENSE) 그대로 적용.
