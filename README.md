# OpenClaw Custom — Orchestrator Fork

OpenClaw에 **멀티에이전트 오케스트레이션 패턴**을 추가한 포크.
메인 에이전트(Sisyphus)가 직접 작업하지 않고, 전문가 서브에이전트(Oracle, Librarian, Explorer)에 자율 위임하여 결과를 종합하는 구조.

> Upstream: [openclaw/openclaw](https://github.com/openclaw/openclaw) · 포크 시점: `17578d7`

---

## 순정 OpenClaw 대비 변경 사항

### 소스 코드 변경 (3파일, ~15줄)

| 파일                                     | 변경 내용                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/config/types.agents.ts`             | `AgentConfig.subagents`에 `defaultAgentId?: string` 타입 추가                               |
| `src/config/zod-schema.agent-runtime.ts` | Zod 스키마에 `defaultAgentId` 필드 추가                                                     |
| `src/agents/subagent-spawn.ts`           | 스폰 fallback 로직 변경: `requestedAgentId ?? configuredDefaultAgentId ?? requesterAgentId` |

### 왜 소스 수정이 필요했나

OpenClaw의 도구 정책 파이프라인은 **서브에이전트가 부모의 도구 정책을 상속**하는 구조.
모델이 `sessions_spawn` 호출 시 `agentId`를 생략하면 부모(main)의 세션키(`agent:main:subagent:...`)가 생성되고,
main의 제한적 도구 정책이 서브에이전트에도 적용되어 read/exec를 사용할 수 없게 됨.

`defaultAgentId`를 추가하여, `agentId` 생략 시 **지정된 기본 에이전트**(예: `explore`)의 세션키가 생성되도록 변경.
이로써 서브에이전트는 자신의 agent config에 따른 도구를 사용할 수 있게 됨.

```
// 변경 전
targetAgentId = requestedAgentId ?? requesterAgentId  // "main"으로 fallback → main 도구 정책 상속

// 변경 후
targetAgentId = requestedAgentId ?? configuredDefaultAgentId ?? requesterAgentId
//                                  ↑ "explore"로 fallback → explore 도구 정책 적용
```

### 추가 파일

| 파일            | 설명                                                    |
| --------------- | ------------------------------------------------------- |
| `run-custom.sh` | 기존 `~/.openclaw`와 완전 격리된 인스턴스 실행 스크립트 |

---

## 아키텍처

```
┌─────────────────────────────────────────────────┐
│  사용자 질문                                      │
└──────────────────┬──────────────────────────────┘
                   ▼
┌──────────────────────────────────────────────────┐
│  Main (Sisyphus)                                 │
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
                   │ auto-announce
                   ▼
          Main이 결과 종합 → 사용자에게 전달
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

### 2. 격리 환경 생성

```bash
mkdir -p ~/.openclaw-custom
```

### 3. 설정 파일 작성

`~/.openclaw-custom/openclaw.json` 생성:

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
        "id": "main",
        "default": true,
        "name": "Sisyphus",
        "model": { "primary": "anthropic/claude-opus-4-6" },
        "subagents": {
          "allowAgents": ["oracle", "librarian", "explore"],
          "defaultAgentId": "explore", // ← 핵심: agentId 생략 시 explore로 fallback
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
            "cron",
            "gateway",
            "canvas",
            "browser",
            "nodes",
            "tts",
            "sessions_spawn",
            "subagents",
          ],
        },
      },
      {
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
            "cron",
            "gateway",
            "canvas",
            "browser",
            "nodes",
            "tts",
            "sessions_spawn",
            "subagents",
          ],
        },
      },
      {
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
            "cron",
            "gateway",
            "canvas",
            "browser",
            "nodes",
            "tts",
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
    "port": 19789,
    "mode": "local",
    "bind": "loopback",
    "auth": { "mode": "none" },
  },
}
```

### 4. 인증 설정

```bash
# 기존 OpenClaw 인증 복사 (이미 설정된 경우)
cp ~/.openclaw/credentials/* ~/.openclaw-custom/credentials/

# 또는 새로 로그인
./run-custom.sh login
```

### 5. 워크스페이스 파일 생성

`~/.openclaw-custom/workspace/AGENTS.md` — 메인 에이전트의 행동을 정의:

```markdown
# HARD RULE: You are an ORCHESTRATOR, not a worker.

**You MUST delegate using `sessions_spawn`. You MUST NOT do research or analysis yourself.**

When a user asks a question that requires ANY of the following, you MUST spawn a sub-agent:

- Reading or searching code → spawn `explore` agent
- Looking up documentation, APIs, or external info → spawn `librarian` agent
- Architecture analysis, debugging, or deep reasoning → spawn `oracle` agent

**The ONLY time you may answer directly** is for trivial conversational replies.
```

### 6. 실행

```bash
./run-custom.sh              # 게이트웨이 실행 (포트 19789)
./run-custom.sh status       # 상태 확인
./run-custom.sh doctor       # 진단
```

웹 UI: `http://localhost:19789`

---

## 모델 변경 가이드

### 에이전트별 모델 갈아끼기

`~/.openclaw-custom/openclaw.json`의 각 에이전트 `model` 필드 수정:

```jsonc
{
  "id": "oracle",
  "model": {
    "primary": "openai/o3", // 메인 모델
    "fallbacks": ["anthropic/claude-opus-4-6"], // fallback (primary 실패 시)
  },
}
```

#### 모델 ID 형식

```
{provider}/{model-id}
```

| Provider    | 예시                                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| `anthropic` | `anthropic/claude-opus-4-6`, `anthropic/claude-sonnet-4-20250514`, `anthropic/claude-haiku-3.5-20250512` |
| `openai`    | `openai/gpt-4.1`, `openai/o3`, `openai/codex-5.3`                                                        |
| `google`    | `google/gemini-2.5-pro`, `google/gemini-2.5-flash`                                                       |

#### 실전 예시: 비용 최적화

```jsonc
// Explorer — 빠르고 저렴한 모델로 코드 검색
{ "id": "explore", "model": { "primary": "anthropic/claude-haiku-3.5-20250512" } }

// Librarian — 중간 티어로 문서 분석
{ "id": "librarian", "model": { "primary": "anthropic/claude-sonnet-4-20250514" } }

// Oracle — 최고 모델로 아키텍처 분석
{ "id": "oracle", "model": { "primary": "openai/codex-5.3" } }

// Main — 위임만 하므로 아무 모델이나 상관없음 (하지만 종합 품질을 위해 고성능 권장)
{ "id": "main", "model": { "primary": "anthropic/claude-opus-4-6" } }
```

#### 실전 예시: 전부 OpenAI로 통일

```jsonc
{ "id": "main",      "model": { "primary": "openai/o3" } },
{ "id": "oracle",    "model": { "primary": "openai/o3" } },
{ "id": "librarian", "model": { "primary": "openai/gpt-4.1" } },
{ "id": "explore",   "model": { "primary": "openai/gpt-4.1-mini" } }
```

### Thinking 레벨 조정

서브에이전트 스폰 시 `thinking` 파라미터로 사고 깊이 조절:

```json
{ "agentId": "oracle", "task": "...", "thinking": "xhigh" }
```

| 레벨     | 설명        | 비용 | 용도                 |
| -------- | ----------- | ---- | -------------------- |
| `none`   | 사고 없음   | 최저 | 단순 검색            |
| `low`    | 간단한 추론 | 낮음 | 코드 검색, 패턴 찾기 |
| `medium` | 보통 추론   | 보통 | 문서 분석, 요약      |
| `high`   | 심층 추론   | 높음 | 복잡한 분석          |
| `xhigh`  | 최대 추론   | 최고 | 아키텍처, 디버깅     |

---

## 에이전트 추가하기

새 전문가 에이전트를 추가하려면 `openclaw.json`의 `agents.list`에 항목 추가:

```jsonc
{
  "id": "writer",
  "name": "Writer",
  "model": { "primary": "anthropic/claude-opus-4-6" },
  "tools": {
    "profile": "coding",
    "alsoAllow": ["write", "edit"],
    "deny": ["exec", "process", "message", "sessions_spawn", "subagents"],
  },
}
```

그리고 main의 `allowAgents`에 추가:

```jsonc
{ "id": "main", "subagents": { "allowAgents": ["oracle", "librarian", "explore", "writer"] } }
```

---

## 도구 정책 구조

각 에이전트가 사용할 수 있는 도구는 `tools` 블록으로 제어:

```jsonc
"tools": {
  "profile": "coding",         // 기본 프로필: minimal | coding | messaging | full
  "allow": ["tool1", "tool2"], // 화이트리스트 (이것만 허용)
  "alsoAllow": ["web_search"], // 프로필에 추가로 허용
  "deny": ["write", "exec"]   // 블랙리스트 (이것만 차단)
}
```

- `allow`와 `profile`은 동시 사용 불가 (allow가 우선)
- `alsoAllow`는 profile과 함께 사용 (profile 기본 도구 + 추가 도구)
- `deny`는 최종 차단 (profile/allow 결과에서 제거)

---

## 격리 구조

기존 OpenClaw(`~/.openclaw`, 포트 18789)와 완전히 분리:

| 항목            | 기존                        | 커스텀                             |
| --------------- | --------------------------- | ---------------------------------- |
| 상태 디렉토리   | `~/.openclaw/`              | `~/.openclaw-custom/`              |
| 설정 파일       | `~/.openclaw/openclaw.json` | `~/.openclaw-custom/openclaw.json` |
| 게이트웨이 포트 | 18789                       | 19789                              |
| 서비스 라벨     | `ai.openclaw`               | `ai.openclaw.custom`               |
| 웹 UI           | `localhost:18789`           | `localhost:19789`                  |

두 인스턴스를 동시에 실행할 수 있음.

---

## Upstream 동기화

```bash
git fetch origin                    # upstream 최신 가져오기
git log --oneline origin/main -5    # 변경 사항 확인
git rebase origin/main              # 내 변경 위에 rebase
pnpm install && pnpm build          # 재빌드
```

소스 변경이 3파일/15줄이라 충돌 가능성 매우 낮음.

---

## License

Upstream [MIT License](LICENSE) 그대로.
