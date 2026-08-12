import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { LandingPage } from "@/features/marketing/components/landing-page";

export default async function Home() {
  const session = await auth();
  if (session?.user?.id) {
    redirect("/dashboard");
  }
  return <LandingPage />;
}
