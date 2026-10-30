# tools/gg-mock/make_test_page.py
# 用"另存为网页"保存的 PokerCraft 锦标赛页面做一个本地测试页：去掉 GG 自己的脚本，
# 塞进 pokercraft-rules.js / pokercraft-dom.js、GG 勾选逻辑的模拟和测试，打开页面就跑。
# 保存的页面里是自己的对局数据，测试页只放在本机，别提交。
#
#   python tools/gg-mock/make_test_page.py "<保存的 .html>" <输出的 .html>
#   打开输出的页面，标题显示 PASS n 或 FAIL k/n，明细在 window.__ggTestResults

import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))

CHROME_STUB = """
window.chrome = window.chrome || {};
chrome.storage = { local: { get: (k, cb) => cb && cb({}), set: (o, cb) => cb && cb() } };
chrome.runtime = { sendMessage: () => {}, onMessage: { addListener: () => {} }, getURL: (p) => p, lastError: null };
"""


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def main():
    if len(sys.argv) != 3:
        print(__doc__ or "用法见文件开头")
        return 1
    html = read(sys.argv[1])
    html = re.sub(r"<script\b[^>]*>.*?</script>", "", html, flags=re.S | re.I)
    html = re.sub(r"<link\b[^>]*modulepreload[^>]*>", "", html, flags=re.I)
    scripts = [CHROME_STUB] + [read(os.path.join(ROOT, n)) for n in ("pokercraft-rules.js", "pokercraft-dom.js")]
    scripts += [read(os.path.join(HERE, n)) for n in ("gg-selection-mock.js", "selection-tests.js")]
    # 内联脚本里的 </script> 会提前结束标签
    inject = "".join("<script>%s</script>\n" % s.replace("</script", "<\\/script") for s in scripts)
    i = html.lower().rfind("</body>")
    html = html[:i] + inject + html[i:] if i >= 0 else html + inject
    with open(sys.argv[2], "w", encoding="utf-8") as f:
        f.write(html)
    print("测试页: %s" % sys.argv[2])
    return 0


if __name__ == "__main__":
    sys.exit(main())
