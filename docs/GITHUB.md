# GitHub: подключение репозитория

Вариант A (через GitHub CLI `gh`)
1) Установить gh.
2) В корне проекта:
   - `git init`
   - `git add .`
   - `git commit -m "chore: bootstrap repo"`
   - `gh auth login`
   - `gh repo create plankanban --private --source=. --remote=origin --push`

Вариант B (вручную)
1) Создать репозиторий на github.com (private).
2) В корне проекта:
   - `git init`
   - `git add .`
   - `git commit -m "chore: bootstrap repo"`
   - `git remote add origin git@github.com:<user>/<repo>.git`
   - `git push -u origin main`

Рекомендация:
- включить Branch protection для `main`
- включить обязательные PR (без прямых пушей)
- включить Dependabot alerts

