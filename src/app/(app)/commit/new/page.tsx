import { redirect } from "next/navigation";
export default function NewGroupPage() { redirect("/tasks?groups=create"); }
