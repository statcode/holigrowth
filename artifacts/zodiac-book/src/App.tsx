import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Create from "@/pages/create";
import Preview from "@/pages/preview";
import Order from "@/pages/order";
import Checkout from "@/pages/checkout";
import Success from "@/pages/success";
import Track from "@/pages/track";
import Admin from "@/pages/admin";
import Invite from "@/pages/invite";
import Privacy from "@/pages/privacy";
import Terms from "@/pages/terms";
import Contact from "@/pages/contact";
import { AdminProvider } from "@/contexts/admin-context";
import { AdminToolbar } from "@/components/admin-toolbar";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/create" component={Create} />
      <Route path="/preview/:id" component={Preview} />
      <Route path="/order/:id" component={Order} />
      <Route path="/order/:id/checkout" component={Checkout} />
      <Route path="/success/:id" component={Success} />
      <Route path="/track" component={Track} />
      <Route path="/admin" component={Admin} />
      <Route path="/invite/:code" component={Invite} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/terms" component={Terms} />
      <Route path="/contact" component={Contact} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AdminProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
            <AdminToolbar />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </AdminProvider>
    </QueryClientProvider>
  );
}

export default App;
