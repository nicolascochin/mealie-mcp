import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('dependabot-mealie workflow', () => {
  const workflow = read('.github/workflows/dependabot-mealie.yml');

  it('only merges Dependabot Docker updates whose whole CI passed', () => {
    expect(workflow).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(workflow).toContain("github.event.workflow_run.event == 'pull_request'");
    expect(workflow).toContain("github.event.workflow_run.actor.login == 'dependabot[bot]'");
    expect(workflow).toContain('github.event.workflow_run.head_repository.full_name == github.repository');
    expect(workflow).toContain("startsWith(github.event.workflow_run.head_branch, 'dependabot/docker/')");
    expect(workflow).toMatch(/gh pr merge "\$BRANCH" --squash --match-head-commit "\$SHA"/);
  });

  it('never runs the code of the pull request it merges', () => {
    expect(workflow).not.toContain('actions/checkout');
    // Event values reach the shell through environment variables only.
    expect(workflow.split('\n').filter((line) => line.includes('run:') && line.includes('${{'))).toEqual([]);
  });
});
