import { WorldView } from "../../../components/game/WorldView";

export default async function WorldPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  return <WorldView guildId={guildId} />;
}
