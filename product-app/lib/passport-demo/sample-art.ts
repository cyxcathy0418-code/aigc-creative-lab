// An original vector illustration of a fictional demonstration product.
// It is deliberately identified as an illustration, never product photography.
export const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="900" viewBox="0 0 720 900">
<defs><linearGradient id="b" x2=".8" y2="1"><stop stop-color="#e8eee7"/><stop offset="1" stop-color="#cad7c6"/></linearGradient><linearGradient id="g"><stop stop-color="#17372b"/><stop offset=".45" stop-color="#395c46"/><stop offset=".72" stop-color="#31523e"/><stop offset="1" stop-color="#112c23"/></linearGradient><linearGradient id="s"><stop stop-color="#a6aeaa"/><stop offset=".4" stop-color="#f2f4ef"/><stop offset="1" stop-color="#949e96"/></linearGradient><filter id="blur"><feGaussianBlur stdDeviation="18"/></filter><pattern id="grain" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M1 0V8M5 0V8" stroke="#a1b39d" opacity=".11"/></pattern></defs>
<rect width="720" height="900" fill="url(#b)"/><rect width="720" height="900" fill="url(#grain)"/>
<circle cx="625" cy="90" r="280" fill="#f6f8e9" opacity=".45"/><path d="M0 755L720 680V900H0" fill="#c2cfbe"/>
<ellipse cx="361" cy="755" rx="158" ry="27" fill="#1a3026" opacity=".24" filter="url(#blur)"/>
<path d="M286 308Q361 284 436 308V698Q362 729 286 698Z" fill="url(#g)"/>
<ellipse cx="361" cy="308" rx="75" ry="21" fill="#4b6a53"/><ellipse cx="361" cy="309" rx="61" ry="14" fill="#162d23"/>
<path d="M286 606Q361 631 436 606V628Q361 655 286 628Z" fill="url(#s)"/>
<path d="M286 696Q361 725 436 696V722Q361 754 286 722Z" fill="url(#g)"/><ellipse cx="361" cy="724" rx="75" ry="21" fill="#193b2b"/>
<path d="M295 336V580" stroke="#aac0a5" stroke-width="3" opacity=".2"/>
<path d="M361 305V250L492 225" fill="none" stroke="#8e9990" stroke-width="15" stroke-linejoin="round"/>
<path d="M361 304V249L491 224" fill="none" stroke="#e7eae2" stroke-width="7" stroke-linejoin="round"/>
<ellipse cx="510" cy="217" rx="45" ry="27" fill="#7b5433" transform="rotate(-12 510 217)"/><ellipse cx="510" cy="210" rx="45" ry="24" fill="#af8359" transform="rotate(-12 510 210)"/>
<path d="M326 434H396M326 444H378" stroke="#cad8bd" stroke-width="3" opacity=".5"/>
<text x="361" y="486" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" letter-spacing="7" fill="#e3e9d6">ROAM</text>
<text x="361" y="511" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" letter-spacing="2" fill="#adc1a5">MAKE YOUR MOMENT</text>
</svg>`;
export const sampleImageUrl = () =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SAMPLE_SVG)}`;
