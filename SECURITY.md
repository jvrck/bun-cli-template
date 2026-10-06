# Security policy

## Reporting a vulnerability

Please report security vulnerabilities **privately** through GitHub's private
vulnerability reporting:

<https://github.com/jvrck/bun-cli-template/security/advisories/new>

(Repository **Security** tab → **Report a vulnerability**.) Do not open a public
issue, pull request or discussion for a suspected vulnerability. If the private
form is unavailable, open a public issue that asks for a private contact
channel — without any vulnerability details.

Please include what is affected (the template's workflows, `install.sh`, the
example CLI, or the generated release assets), the version or commit, how to
reproduce, and the impact you expect. You will receive an acknowledgement once
the report has been triaged. This is a volunteer-maintained project, so there
is no guaranteed response time; please allow a reasonable period for a fix
before any public disclosure.

## Supported versions

Only the latest release and the current `main` branch receive fixes.

## Scope notes

- The template ships no network service. Its security-relevant surfaces are the
  release workflows, `install.sh` (download and checksum verification), and the
  dependency-scanning configuration.
- Vulnerabilities in dependencies are tracked by Dependabot and the OSV/Trivy
  workflows (see [docs/security.md](docs/security.md)); report them upstream
  unless the template's own configuration makes them exploitable.
- Tools created from this template are maintained by their own authors. Report
  issues in those tools to their repositories.
