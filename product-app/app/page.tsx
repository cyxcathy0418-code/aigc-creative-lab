import Link from "next/link";

const workflow = [
  {
    index: "01",
    title: "上传真实商品图",
    body: "用清晰的多角度图片建立商品档案，不必为每个广告重新描述。",
  },
  {
    index: "02",
    title: "确认商品身份",
    body: "锁定颜色、轮廓、材质与品牌标识，避免生成结果悄悄改款。",
  },
  {
    index: "03",
    title: "选择目标市场",
    body: "按地区、渠道和使用场景组织创意方向，而不是堆叠提示词。",
  },
  {
    index: "04",
    title: "生成并挑选广告",
    body: "得到围绕同一 SKU 的广告候选，保留过程记录，方便继续迭代。",
  },
];

export default function Home() {
  return (
    <main>
      <header className="site-header">
        <Link className="wordmark" href="/" aria-label="Brand Anchor Studio 首页">
          <span className="brand-dot" aria-hidden="true" />
          <span>Brand Anchor</span>
          <span className="wordmark-muted">Studio</span>
        </Link>
        <nav className="header-nav" aria-label="主导航">
          <a href="#workflow">工作方式</a>
          <a href="#beta">Beta 说明</a>
          <Link className="button button-small button-dark" href="/login">
            登录工作台
          </Link>
        </nav>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="pulse-dot" aria-hidden="true" />
            邀请制 Beta · 正在开放
          </div>
          <h1>
            Built Around the Product.
            <br />
            <span>Made for the Market.</span>
          </h1>
          <p className="hero-lede">
            以真实商品为创意原点，锁定颜色、轮廓、材质和品牌标识，再为每个市场构建属于当地语境的广告素材。
          </p>
          <div className="hero-actions">
            <Link className="button button-primary" href="/login">
              申请 Beta 使用权限
              <span aria-hidden="true">↗</span>
            </Link>
            <a className="text-link" href="#workflow">
              查看工作方式 <span aria-hidden="true">↓</span>
            </a>
          </div>
          <p className="hero-note">
            当前由项目方审核并邀请账号，不开放自主注册，也不收取费用。
          </p>
        </div>

        <div className="anchor-stage" aria-label="同一商品适配多个市场的示意图">
          <div className="stage-grid" aria-hidden="true" />
          <div className="source-card">
            <div className="source-topline">
              <span>PRODUCT / 001</span>
              <span>已锚定</span>
            </div>
            <div className="product-shape" aria-hidden="true">
              <span className="product-cap" />
              <span className="product-body" />
              <span className="product-label">A</span>
            </div>
            <div>
              <p className="source-title">Hero Bottle</p>
              <p className="source-meta">颜色 · 轮廓 · Logo · 材质</p>
            </div>
          </div>

          <div className="anchor-rail" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>

          <div className="market-card market-card-one">
            <span>JP / SOCIAL</span>
            <strong>静谧晨间</strong>
            <small>同一商品身份</small>
          </div>
          <div className="market-card market-card-two">
            <span>US / DISPLAY</span>
            <strong>Outdoor Energy</strong>
            <small>同一商品身份</small>
          </div>
          <div className="market-card market-card-three">
            <span>EU / PDP</span>
            <strong>Clean Detail</strong>
            <small>同一商品身份</small>
          </div>

          <div className="stage-caption">
            <span>ANCHOR RAIL</span>
            <p>创意可以变化，商品身份始终沿同一条轨道传递。</p>
          </div>
        </div>
      </section>

      <section className="proof-strip" aria-label="产品原则">
        <div>
          <span>01</span>
          <p>先确认商品，再做创意</p>
        </div>
        <div>
          <span>02</span>
          <p>一次建档，多市场复用</p>
        </div>
        <div>
          <span>03</span>
          <p>过程留痕，结果可回看</p>
        </div>
      </section>

      <section className="workflow-section" id="workflow">
        <div className="section-heading">
          <p className="section-kicker">WORKFLOW / FROM SOURCE TO SCENE</p>
          <h2>Start with what’s real. Make it feel native.</h2>
          <p>
            第一阶段先把产品底座和登录边界做扎实。商品建档与生成能力会在后续阶段逐步开放。
          </p>
        </div>
        <div className="workflow-grid">
          {workflow.map((item) => (
            <article className="workflow-card" key={item.index}>
              <span className="workflow-index">{item.index}</span>
              <div>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="beta-section" id="beta">
        <div>
          <p className="section-kicker">PRIVATE BETA / EARLY ACCESS</p>
          <h2>The next market is closer than it looks.</h2>
        </div>
        <div className="beta-copy">
          <p>
            Beta 期间，我们会邀请有真实商品和投放需求的跨境卖家、独立站团队与小型品牌。
            你将使用真实在线产品，而不是只观看演示。
          </p>
          <ul>
            <li>邮箱邀请后登录</li>
            <li>首阶段免费，不接真实支付</li>
            <li>逐步开放商品库与广告生成</li>
          </ul>
          <Link className="button button-light" href="/login">
            查看登录与申请方式
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>

      <footer className="site-footer">
        <Link className="wordmark wordmark-footer" href="/">
          <span className="brand-dot" aria-hidden="true" />
          Brand Anchor Studio
        </Link>
        <p>让商品保持真实，让创意适应市场。</p>
        <span>Phase 0 · Product Foundation</span>
      </footer>
    </main>
  );
}
