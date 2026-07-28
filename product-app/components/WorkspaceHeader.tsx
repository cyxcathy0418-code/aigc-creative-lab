import Link from "next/link";

type WorkspaceHeaderProps = {
  email?: string | null;
};

export function WorkspaceHeader({ email }: WorkspaceHeaderProps) {
  return (
    <header className="dashboard-header">
      <Link className="wordmark" href="/">
        <span className="brand-dot" aria-hidden="true" />
        <span>Brand Anchor</span>
        <span className="wordmark-muted">Studio</span>
      </Link>
      <nav className="workspace-nav" aria-label="工作台导航">
        <Link href="/dashboard">商品</Link>
        <span>{email ?? "Beta workspace"}</span>
        {email ? (
          <form action="/auth/signout" method="post">
            <button className="signout-button" type="submit">
              退出
            </button>
          </form>
        ) : null}
      </nav>
    </header>
  );
}
