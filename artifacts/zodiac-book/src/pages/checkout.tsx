import { useLocation, useParams } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { motion } from "framer-motion";
import { Loader2, CheckCircle } from "lucide-react";
import { useGetZodiacOrder, getGetZodiacOrderQueryKey, useSubmitToLulu, useGetSiteSettings, getGetSiteSettingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

const formSchema = z.object({
  shippingName: z.string().min(2, "Name is required"),
  shippingAddress1: z.string().min(5, "Address is required"),
  shippingAddress2: z.string().optional(),
  shippingCity: z.string().min(2, "City is required"),
  shippingState: z.string().min(2, "State/Province is required"),
  shippingZip: z.string().min(3, "Zip/Postal Code is required"),
  shippingCountry: z.string().min(2, "Country is required"),
  email: z.string().email("Valid email is required"),
});

type FormValues = z.infer<typeof formSchema>;

export default function Checkout() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id || "0", 10);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: order, isLoading } = useGetZodiacOrder(id, {
    query: {
      enabled: !!id,
      queryKey: getGetZodiacOrderQueryKey(id),
    }
  });
  const { data: siteSettings } = useGetSiteSettings({
    query: { queryKey: getGetSiteSettingsQueryKey() },
  });

  const submitToLulu = useSubmitToLulu();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      shippingName: order?.fullName || "",
      shippingAddress1: "",
      shippingAddress2: "",
      shippingCity: "",
      shippingState: "",
      shippingZip: "",
      shippingCountry: "",
      email: order?.email || "",
    },
  });

  const onSubmit = (data: FormValues) => {
    submitToLulu.mutate(
      { id, data },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetZodiacOrderQueryKey(id) });
        }
      }
    );
  };

  const Nav = () => (
    <header className="py-4 px-6 border-b border-border bg-white/80 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto flex justify-center">
        <a href="/">
          <img src="/images/holigrowth-logo.png" alt="Holigrowth" className="h-9 w-auto" />
        </a>
      </div>
    </header>
  );

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Nav />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (!order) return null;

  // Success State
  if (order.status === "submitting" || order.status === "processing" || order.status === "shipped") {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Nav />
        <div className="flex-1 flex items-center justify-center p-6">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white border border-border p-12 rounded-3xl max-w-lg w-full text-center shadow-lg"
          >
            <div className="w-20 h-20 rounded-full bg-secondary/15 flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-10 h-10 text-primary" />
            </div>
            <h2 className="text-3xl font-serif mb-4 text-foreground">Your Order is Confirmed</h2>
            <p className="text-muted-foreground mb-8">
              The stars have aligned. Your beautiful book is now entering the press. We will email shipping updates to {order.email}.
            </p>
            <Button
              data-testid="button-return-home"
              onClick={() => setLocation("/")}
              variant="outline"
              className="w-full border-primary/30 text-primary hover:bg-primary/5"
            >
              Return Home
            </Button>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Nav />
      <div className="max-w-5xl mx-auto py-16 px-6 grid md:grid-cols-2 gap-16">
        {/* Form Column */}
        <div>
          <h1 className="text-3xl font-serif mb-8 text-foreground">Shipping Details</h1>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-primary/80 text-xs uppercase tracking-widest">Email for Receipt</FormLabel>
                  <FormControl><Input data-testid="input-email" {...field} className="bg-white" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="shippingName" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-primary/80 text-xs uppercase tracking-widest">Full Name</FormLabel>
                  <FormControl><Input data-testid="input-shipping-name" {...field} className="bg-white" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="shippingAddress1" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-primary/80 text-xs uppercase tracking-widest">Street Address</FormLabel>
                  <FormControl><Input data-testid="input-address1" {...field} className="bg-white" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="shippingAddress2" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-primary/80 text-xs uppercase tracking-widest">Apt, Suite, etc. (Optional)</FormLabel>
                  <FormControl><Input data-testid="input-address2" {...field} className="bg-white" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="shippingCity" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-primary/80 text-xs uppercase tracking-widest">City</FormLabel>
                    <FormControl><Input data-testid="input-city" {...field} className="bg-white" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="shippingState" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-primary/80 text-xs uppercase tracking-widest">State / Province</FormLabel>
                    <FormControl><Input data-testid="input-state" {...field} className="bg-white" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="shippingZip" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-primary/80 text-xs uppercase tracking-widest">ZIP / Postal Code</FormLabel>
                    <FormControl><Input data-testid="input-zip" {...field} className="bg-white" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="shippingCountry" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-primary/80 text-xs uppercase tracking-widest">Country</FormLabel>
                    <FormControl><Input data-testid="input-country" {...field} className="bg-white" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <Button
                data-testid="button-complete-order"
                type="submit"
                disabled={submitToLulu.isPending}
                className="w-full h-14 text-lg bg-primary text-primary-foreground hover:bg-primary/90 mt-4 rounded-xl shadow-[0_4px_16px_rgba(1,91,92,0.3)]"
              >
                {submitToLulu.isPending ? <Loader2 className="w-6 h-6 animate-spin" /> : "Complete Order"}
              </Button>
            </form>
          </Form>
        </div>

        {/* Order Summary Column */}
        <div>
          <div className="bg-white border border-border rounded-3xl p-8 sticky top-24 shadow-sm">
            <h2 className="text-2xl font-serif mb-6 text-primary">Order Summary</h2>

            <div className="flex gap-6 items-start mb-8">
              <div className="w-24 h-32 bg-muted rounded-lg shadow overflow-hidden relative flex-shrink-0">
                <img src="/images/book-mockup.png" alt="Book Preview" className="w-full h-full object-cover" />
              </div>
              <div>
                <h3 className="font-serif text-lg text-foreground mb-1">Holistic Growth Life Path Hardcover</h3>
                <p className="text-sm text-muted-foreground">Customized for {order.fullName}</p>
                {order.sunSign && (
                  <p className="text-xs text-secondary mt-2">{order.sunSign} Sun</p>
                )}
              </div>
            </div>

            <div className="space-y-3 text-sm text-muted-foreground border-y border-border py-6 mb-6">
              <div className="flex justify-between items-center">
                <span>Subtotal</span>
                <div className="flex items-center gap-2">
                  {siteSettings?.originalPriceUsd && (
                    <span className="text-muted-foreground/60 line-through text-xs">${siteSettings.originalPriceUsd.toFixed(2)}</span>
                  )}
                  <span className="text-foreground font-medium">${(order.priceUsd || siteSettings?.priceUsd || 99.99).toFixed(2)}</span>
                </div>
              </div>
              <div className="flex justify-between">
                <span>Shipping</span>
                <span>Calculated at press</span>
              </div>
            </div>

            <div className="flex justify-between text-lg font-serif text-foreground">
              <span>Estimated Total</span>
              <span className="text-primary">${(order.priceUsd || siteSettings?.priceUsd || 99.99).toFixed(2)} + Shipping</span>
            </div>

            <p className="text-xs text-muted-foreground/60 mt-6 text-center leading-relaxed">
              Secure checkout. Payment handled upon printing. Allow 2–3 weeks for delivery.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
