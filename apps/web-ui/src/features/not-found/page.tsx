import { Button } from "../../components/ui/button";
import { useNavigate } from "react-router-dom";

/**
 * 404 Not Found page.
 *
 * Displayed when the user navigates to a route that does not exist.
 * Provides a link back to the dashboard.
 */
export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <h1 className="text-4xl font-bold">404</h1>
      <p className="text-muted-foreground">Page not found</p>
      <Button variant="outline" onClick={() => navigate("/dashboard")}>
        Back to Dashboard
      </Button>
    </div>
  );
}
