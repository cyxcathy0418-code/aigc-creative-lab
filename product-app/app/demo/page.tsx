import type { Metadata } from "next";
import WorkspaceApp from "@/components/passport-demo/Workspace";
import "@/components/passport-demo/workspace.css";
export const metadata: Metadata = {
  title: "Creative Passport · Demo",
  description:
    "A guided cross-market creative workspace. Template suggestions, confirmed facts and real video exports.",
};
export default function DemoPage() {
  return <WorkspaceApp />;
}
