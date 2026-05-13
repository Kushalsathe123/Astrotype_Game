import { createFileRoute } from "@tanstack/react-router";
import GameCanvas from "@/components/GameCanvas";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AstroType — Type to Destroy Asteroids" },
      { name: "description", content: "A space-themed typing game. Destroy falling asteroids by typing their words before they reach the bottom." },
      { property: "og:title", content: "AstroType" },
      { property: "og:description", content: "Type to destroy. A retro-future typing arcade." },
    ],
  }),
  component: Index,
});

function Index() {
  return <GameCanvas />;
}
