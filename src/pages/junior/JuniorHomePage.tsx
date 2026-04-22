import { useKidProfile } from '@/hooks/useKidProfile';

export default function JuniorHomePage() {
  const { member, loading } = useKidProfile();

  if (loading) return <p>Loading…</p>;
  if (!member) return <p>Something went wrong — no profile found.</p>;

  return (
    <section className="junior-hero">
      <h1>Welcome, {member.name}! 👋</h1>
      <p>
        Your money stuff is coming soon. Chores, missions, savings, and Save /
        Spend / Give jars will show up here next.
      </p>
    </section>
  );
}
