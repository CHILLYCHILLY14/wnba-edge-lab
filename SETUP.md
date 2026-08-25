# Setup

1. Create a GitHub repository named `wnba-edge-lab`.
2. Upload this package to the repository root and commit to `main`.
3. In **Settings → Pages**, choose **GitHub Actions** as the source.
4. Push a change or run **Refresh and deploy WNBA Edge Lab** from Actions.

No feed credentials, spreadsheet, copied odds or slate file is required. The
scheduled workflow refreshes the public ESPN WNBA feeds automatically, commits
only updated real-data state, and deploys `site/` to GitHub Pages.

For local verification:

```bash
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
python -m pipeline.build
```

The offline option uses only the latest successfully fetched real-data cache:

```bash
python -m pipeline.build --offline
```
