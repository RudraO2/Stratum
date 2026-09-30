# Third-party notices

Stratum is built on DeepSeek Harness (the relationship the harness's own `BRAND_GUIDELINES.md`
blesses: "built on DeepSeek Harness") and reuses the plugin code of the same author's earlier
project, Faraday (MIT). Both components below are MIT and both require the copyright notice to
be retained; this file is that retention.

Stratum's rule is **permissive licences only**. `PyMuPDF` (AGPL) is not used — pages are rendered
with `pypdfium2`, layout is read by Docling (MIT), the models are Apache-2.0 Qwen weights.
`npm run licence-audit` enforces it: it reads the Python environment the backend actually runs in
and fails on an AGPL/GPL/unknown licence or on PyMuPDF being installed.

## Models

| Model | Role | Licence | Verified from |
|---|---|---|---|
| Qwen3-4B (GGUF, Q4_K_M) | wording, table mapping, query intent | Apache-2.0 | LICENSE file at the pinned revision (`registry/models.yaml`) |
| Qwen3-VL-2B-Instruct (GGUF, Q4_K_M) | figures and bad scans at ingest; attached images | Apache-2.0 | README frontmatter at the pinned revision |
| multilingual-e5-small | passage and query embeddings (CPU) | MIT | model card |
| Qwen2.5-3B-Instruct | *declared only, refused at load* | Qwen Research Licence | the licence gate refuses it by name at runtime |

## Inference runtime

`llama.cpp` (MIT) and `llama-swap` (MIT) run the models locally; Stratum talks to them over loopback only.

## DeepSeek Harness

`deepseek-ai/deepseek-harness`, read from its `LICENSE` at `master`, 27 August 2026 (see
`docs/licence-policy.md`).

```
MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Cordis

`cordiverse/cordis`, the plugin framework underneath the harness, read from its `LICENSE` at
`main`, 27 August 2026.

```
MIT License

Copyright (c) 2021-present Shigma

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```


## Python backend

Every distribution in the environment the backend runs in, with the licence its metadata declares
(regenerate with `npm run licence-audit -- --write`). One component is weak copyleft and is
disclosed rather than hidden: `certifi` (MPL-2.0, the CA bundle, used unmodified as a library).

<!-- python-table -->
| Package | Version | Licence |
|---|---|---|
| accelerate | 1.15.0 | Apache; Apache Software License |
| annotated-doc | 0.0.5 | MIT |
| annotated-types | 0.8.0 | MIT; MIT License |
| antlr4-python3-runtime | 4.9.3 | BSD |
| anyio | 4.15.1 | MIT |
| attrs | 26.1.0 | MIT |
| beautifulsoup4 | 4.15.0 | MIT License |
| bertopic | 0.17.4 | MIT License |
| certifi | 2026.7.22 | MPL-2.0; Mozilla Public License 2.0 (MPL 2.0) |
| charset-normalizer | 3.5.2 | MIT |
| click | 8.5.0 | BSD-3-Clause |
| cloudpickle | 3.1.2 | BSD-3-Clause; BSD License |
| colorama | 0.4.6 | BSD License |
| colorlog | 6.12.0 | MIT License |
| contourpy | 1.4.0 | BSD-3-Clause |
| cycler | 0.12.1 | BSD License |
| defusedxml | 0.7.1 | PSFL; Python Software Foundation License |
| dill | 0.4.1 | BSD-3-Clause; BSD License |
| doclang | 0.7.3 | Apache-2.0 |
| docling | 2.131.0 | MIT |
| docling-core | 2.99.0 | MIT |
| docling-ibm-models | 4.0.3 | MIT |
| docling-parse | 7.22.1 | MIT |
| docling-slim | 2.131.0 | MIT |
| et_xmlfile | 2.0.0 | MIT; MIT License |
| Faker | 40.40.0 | MIT License |
| fastapi | 0.142.1 | MIT |
| filelock | 4.0.7 | MIT; MIT License |
| filetype | 1.2.0 | MIT; MIT License |
| fonttools | 4.66.1 | MIT |
| fsspec | 2026.9.0 | BSD-3-Clause |
| h11 | 0.16.0 | MIT; MIT License |
| hdbscan | 0.8.44 | BSD; OSI Approved |
| hf-xet | 1.6.0 | Apache-2.0; Apache Software License |
| httpcore | 1.0.9 | BSD-3-Clause; BSD License |
| httpx | 0.28.1 | BSD-3-Clause; BSD License |
| huggingface_hub | 1.33.0 | Apache-2.0; Apache Software License |
| idna | 3.20 | BSD-3-Clause |
| iniconfig | 2.3.0 | MIT |
| Jinja2 | 3.1.6 | BSD License |
| joblib | 1.6.0 | BSD-3-Clause |
| jsonref | 1.1.0 | MIT |
| jsonschema | 4.26.0 | MIT |
| jsonschema-specifications | 2025.9.1 | MIT |
| kiwisolver | 1.5.1 | BSD License |
| langcodes | 3.5.1 | MIT License |
| latex2mathml | 3.81.1 | MIT |
| llvmlite | 0.49.0 | BSD-2-Clause AND Apache-2.0 WITH LLVM-exception |
| lxml | 6.1.3 | BSD-3-Clause |
| mail-parser | 4.6.5 | Apache-2.0 |
| markdown-it-py | 4.2.0 | MIT License |
| marko | 2.2.4 | MIT |
| MarkupSafe | 3.0.3 | BSD-3-Clause |
| matplotlib | 3.11.2 | Python Software Foundation License |
| mdurl | 0.1.2 | MIT License |
| mpire | 2.10.2 | MIT; MIT License |
| mpmath | 1.3.0 | BSD; BSD License |
| multiprocess | 0.70.19 | BSD-3-Clause; BSD License |
| narwhals | 2.26.0 | MIT |
| networkx | 3.7 | BSD-3-Clause |
| numba | 0.67.0 | BSD; BSD License |
| numpy | 2.5.3 | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 |
| olefile | 0.47 | BSD; BSD License |
| omegaconf | 2.3.1 | BSD License |
| opencv-python | 5.0.0.93 | Apache 2.0; Apache Software License |
| openpyxl | 3.1.5 | MIT; MIT License |
| opentelemetry-api | 1.45.0 | Apache-2.0 |
| packaging | 26.3 | Apache-2.0 OR BSD-2-Clause |
| pandas | 3.0.6 | BSD License |
| pillow | 12.3.0 | MIT-CMU |
| plotly | 7.1.0 | MIT; MIT License |
| pluggy | 1.6.0 | MIT; MIT License |
| polyfactory | 3.3.0 | MIT; MIT License |
| psutil | 7.2.2 | BSD-3-Clause |
| pyclipper | 1.4.0 | MIT; OSI Approved; MIT License |
| pydantic | 2.13.5 | MIT |
| pydantic-settings | 2.15.0 | MIT; MIT License |
| pydantic_core | 2.46.5 | MIT |
| Pygments | 2.21.0 | BSD-2-Clause |
| pylatexenc | 2.11 | MIT; MIT License |
| pynndescent | 0.6.0 | BSD-2-Clause |
| pyparsing | 3.3.3 | MIT |
| pypdfium2 | 5.13.0 | BSD-3-Clause, Apache-2.0, dependency licenses |
| pytest | 9.1.1 | MIT |
| python-dateutil | 2.9.0.post0 | Dual License; BSD License; Apache Software License |
| python-docx | 1.2.0 | MIT; MIT License |
| python-dotenv | 1.2.3 | BSD-3-Clause |
| python-multipart | 0.0.32 | Apache-2.0; Apache Software License |
| python-oxmsg | 0.0.2 | MIT; MIT License |
| python-pptx | 1.0.2 | MIT; MIT License |
| pywin32 | 312 | PSF; Python Software Foundation License |
| PyYAML | 6.0.3 | MIT; MIT License |
| rapidocr | 3.9.2 | Apache-2.0 |
| referencing | 0.37.0 | MIT |
| regex | 2026.9.29 | Apache-2.0 AND CNRI-Python |
| reportlab | 5.0.1 | BSD license (see license.txt for details), Copyright (c) 2000-2025, ReportLab Inc.; BSD Li |
| requests | 2.34.2 | Apache-2.0; Apache Software License |
| rich | 15.0.0 | MIT; MIT License |
| rpds-py | 2026.6.3 | MIT |
| rtree | 1.4.1 | MIT |
| safetensors | 0.8.0 | Apache Software License |
| scikit-learn | 1.9.1 | BSD-3-Clause |
| scipy | 1.18.1 | BSD License |
| semchunk | 3.2.5 | MIT; MIT License |
| sentence-transformers | 6.1.0 | Apache-2.0 |
| setuptools | 84.0.0 | MIT |
| shapely | 2.1.2 | BSD 3-Clause; BSD License |
| shellingham | 1.5.4 | ISC License; ISC License (ISCL) |
| six | 1.17.0 | MIT; MIT License |
| soupsieve | 2.10 | MIT; MIT License |
| starlette | 1.7.0 | BSD-3-Clause |
| sympy | 1.14.0 | BSD; BSD License |
| tabulate | 0.10.0 | MIT |
| threadpoolctl | 3.7.0 | BSD-3-Clause |
| tokenizers | 0.23.2 | Apache Software License |
| torch | 2.14.0 | Apache-2.0 AND Apache-2.0 WITH LLVM-exception AND BSD-2-Clause AND BSD-3-Clause AND BSL-1. |
| torchvision | 0.29.0 | BSD |
| tqdm | 4.70.1 | MPL-2.0 AND MIT |
| transformers | 5.17.0 | Apache 2.0 License |
| tree-sitter | 0.26.0 | MIT License |
| tree-sitter-c | 0.24.2 | MIT; MIT License |
| tree-sitter-javascript | 0.25.0 | MIT |
| tree-sitter-python | 0.25.0 | MIT |
| tree-sitter-typescript | 0.23.2 | MIT; MIT License |
| typer | 0.26.8 | MIT |
| typing-inspection | 0.4.4 | MIT |
| typing_extensions | 4.16.0 | PSF-2.0 |
| tzdata | 2026.4 | Apache-2.0 |
| umap-learn | 0.5.12 | BSD; OSI Approved |
| urllib3 | 2.8.0 | MIT |
| uvicorn | 0.54.0 | BSD-3-Clause |
| websockets | 16.1.1 | BSD-3-Clause |
| wordcloud | 1.9.6 | MIT |
| xlsxwriter | 3.2.9 | BSD-2-Clause; BSD License |
<!-- /python-table -->

## The rest of the tree

The harness tree is enumerated, not assumed. The findings that matter are below.

### The one adopted plugin, and the engines it carries

`@changfenhuang/dsh-genui@0.9.3` (**MIT**, Copyright (c) 2026 dsh-external) is the only
third-party plugin this project adopts (inherited from Faraday). It renders the ```dsh-ui fence a model can write tables and charts into. Its licence was read from the `LICENSE` file in the installed
package at the pinned version, not from the repository badge, and it resolves exactly one
runtime dependency of its own: `react` (MIT).

The package also **vendors three rendering engines as prebuilt bundles** under `lib/assets/`,
which no metadata field names — the same class of finding as libvips inside `sharp`:

| Engine | Version | Licence | Read from |
|---|---|---|---|
| Apache ECharts | 5.6.0 | Apache-2.0 | the pinned `pnpm-lock.yaml` at tag `v0.9.3`; `lib/assets/echarts.js` carries the Baidu copyright line |
| three.js | 0.180.0 | MIT | `lib/assets/three.js` carries `SPDX-License-Identifier: MIT` in its own banner |
| Mermaid | 11.16.0 | MIT | the pinned lockfile; its bundle preserves the **DOMPurify 3.4.13** banner, dual `MPL-2.0 OR Apache-2.0` — **Apache-2.0 elected** |

`echarts.js` also carries Microsoft's `tslib` runtime helpers (0BSD). Every licence in that
table is on the allow-list, and the election on DOMPurify is what keeps it there.

**None of the three is executed here.** Stratum's answers render as native cards, and any ```dsh-ui block a model emits is limited to tables, charts and plots is tables,
charts and plots (`plugins/stratum-ui/lib/genui/permitted-set.js`), and none of those three types reaches an engine. Measured in the
running workbench on 29 August 2026: `echarts.js` was never requested at all, and
`mermaid.js` and `three.js` were fetched **from loopback as `<link rel="prefetch">` hints and
never executed** — no script element, no `window.__GenuiAssets__` entry, and `window.mermaid`,
`window.THREE` and `window.echarts` all `undefined`. Redistributed, not linked.

### The harness's own disclosure, checked against what actually installs

`deepseek-ai/deepseek-harness` publishes a `THIRD_PARTY_NOTICES.md` in its repository root
disclosing roughly 150 components. **It is not shipped inside the npm package** — it is not
in `@deepseek-ai/dsh@0.1.1-rc.2` on disk — so it was read from the repository at `master` on
28 August 2026 and cross-checked against the resolved tree.

The check matters because a disclosure is a claim and the installed tree is the fact, and
here they differ in our favour. The three entries in that document that would have been
problems are all absent from what actually installs into a profile:

| Named in the harness's notices | Licence | In the resolved tree? |
|---|---|---|
| `@anthropic-ai/claude-agent-sdk` | "SEE LICENSE IN README.md" — not establishable from metadata | **No.** Only `@anthropic-ai/sdk@0.91.1` (MIT) is present. |
| `eslint-plugin-sonarjs` | LGPL-3.0-only | **No.** Development-only, as its own notice says. |
| `lightningcss` | MPL-2.0 | **No.** Development-only. |

Development dependencies do not install into a `dsh` profile, so the harness's notices
overstate what ships. That is the right direction for a disclosure to err, and it is why this
project's audit enumerates the resolved tree rather than trusting the document: the document
is a superset, and a superset cannot tell you what you are actually shipping.

### Weak copyleft in the resolved tree

Two components carry it, and they are named here because this file is the notice retention
and they are the two that need one:

**libvips**, under **LGPL-3.0-or-later**, reaches the runtime inside
`@img/sharp-win32-x64@0.35.4`, which `sharp@0.35.4` resolves for this platform and which
`@deepseek-ai/dsh-attachment-local` requires. It is shipped unmodified. LGPL-3.0 §4 permits
conveying a work that links a library under these terms provided the library is identified
and can be relinked; this notice is that identification, and the library is the stock
prebuilt binary from the `@img` distribution.

**Eigen**, under **MPL-2.0**, is compiled into `onnxruntime` (used by Docling's OCR engine) and named in that
package's own `ThirdPartyNotices.txt`. It is unmodified. MPL-2.0's source-availability
obligation attaches to modified MPL-licensed files; there are none.

Every other copyleft component found by the audit was removed or is not loaded — see
"Copyleft, decided one at a time" in `docs/licence-policy.md`, and
`docs/licence-decisions.json` for the evidence behind each.
