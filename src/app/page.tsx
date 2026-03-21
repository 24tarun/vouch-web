import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { DesktopLanding } from "@/components/landing/DesktopLanding";
import { MobileLanding } from "@/components/landing/MobileLanding";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  const headersList = await headers();
  const ua = headersList.get("user-agent") ?? "";
  const isMobile = /Mobile|Android|iPhone|iPad|iPod/i.test(ua);

  return isMobile ? <MobileLanding /> : <DesktopLanding />;
}
