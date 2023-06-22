import { buildClerkProps, getAuth } from "@clerk/nextjs/server";
import { type GetServerSideProps } from "next";
import { useState } from "react";

import AdminLayout from "@/components/LayoutAdmin";
import { OrdersTable } from "@/components/OrdersTable";
import LoadingSpinner, { LoadingPage } from "@/components/loading";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/use-toast";
import { cn, convertToNormalCase, isHappyHour } from "@/lib/utils";
import { generateSSGHelper } from "@/server/helpers/ssgHelper";
import { api } from "@/utils/api";
import { zodResolver } from "@hookform/resolvers/zod";
import { type Item } from "@prisma/client";
import dayjs from "dayjs";
import { useForm } from "react-hook-form";
import { z } from "zod";

type SelectedItem = {
  itemName: string;
  itemId: string;
  quantity: number;
  priceUSD: string;
  happyHourPriceUSD: string;
};

type SelectedCustomer = {
  customer: string | null;
  reservationId: string | null;
  guestId: string | null;
};

const FormSchema = z.object({
  room: z.string().optional(),
  name: z.string().optional(),
  reservationId: z.string().optional(),
  guestId: z.string().optional(),
});

export default function OrdersPage() {
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<SelectedCustomer>();
  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
  });

  const { data: items, isLoading: isLoadingItems } =
    api.pos.getItems.useQuery();

  const { data: guests, isLoading: isLoadingGuests } =
    api.guests.getAll.useQuery(undefined, {
      staleTime: 5000,
      refetchOnWindowFocus: true,
    });

  const { mutate: createOrder, isLoading: isAddingOrder } =
    api.pos.createOrder.useMutation({});

  function handleAdd(item: Item) {
    const selectedItem = selectedItems.find(
      (selectedItem) => selectedItem.itemId === item.id
    );

    if (selectedItem) {
      const updatedItems = selectedItems.map((selectedItem) => {
        if (selectedItem.itemId === item.id) {
          return { ...selectedItem, quantity: selectedItem.quantity + 1 };
        }
        return selectedItem;
      });

      setSelectedItems(updatedItems);
    } else {
      setSelectedItems([
        ...selectedItems,
        {
          itemName: item.name,
          itemId: item.id,
          quantity: 1,
          priceUSD: item.priceUSD.toString(),
          happyHourPriceUSD: item.happyHourPriceUSD?.toString() || "",
        },
      ]);
    }
  }

  function onSubmit(data: z.infer<typeof FormSchema>) {
    const orderPayload = {
      ...data,
      items: selectedItems,
    };
    toast({
      title: "Order data",
      description: (
        <pre className="mt-2 w-full rounded-md bg-slate-950 p-4">
          <code className="text-white">
            {JSON.stringify(orderPayload, null, 2)}
          </code>
        </pre>
      ),
    });
    createOrder(orderPayload);
  }

  if (isLoadingItems || isLoadingGuests) return <LoadingPage />;

  return (
    <AdminLayout>
      {isAddingOrder ? (
        <LoadingPage />
      ) : (
        <main className="flex-1 space-y-4 p-8 pt-6">
          <div className="flex items-center justify-between space-y-2">
            <h2 className="text-3xl font-bold tracking-tight">Orders</h2>
          </div>

          <Tabs defaultValue="items" className="space-y-4">
            <TabsList>
              <TabsTrigger value="items">Items</TabsTrigger>
              <TabsTrigger value="open-orders">Open Orders</TabsTrigger>
            </TabsList>
            <TabsContent value="items" className="space-y-4">
              <div className="flex items-center justify-between space-y-2">
                <h3 className="text-2xl font-bold tracking-tight">
                  Select Items
                </h3>
              </div>

              {/* ITEM SELECTION GRID */}
              {isLoadingItems ? (
                <LoadingSpinner size={64} />
              ) : (
                items && (
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    {items.map((item) => {
                      const selectedItem = selectedItems.find(
                        (selectedItem) => selectedItem.itemId === item.id
                      );
                      return (
                        <Card
                          className="cursor-pointer"
                          onClick={() => handleAdd(item)}
                          key={item.id}
                        >
                          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="flex flex-col">
                              <span className="text-2xl">{item.name}</span>
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="flex flex-col gap-y-4">
                            <span className="text-sm font-medium text-muted-foreground">
                              {convertToNormalCase(item.category)}
                            </span>
                            <span className="flex select-none items-center gap-2 text-sm font-medium text-muted-foreground">
                              Qty: {selectedItem ? selectedItem.quantity : 0}
                            </span>
                            <div className="flex gap-2">
                              <span
                                className={cn(
                                  "flex select-none items-center gap-2 text-sm font-medium text-muted-foreground",
                                  isHappyHour() === true &&
                                    item.happyHourPriceUSD &&
                                    "italic text-red-500 line-through"
                                )}
                              >
                                $ {item.priceUSD.toNumber()}
                              </span>
                              {isHappyHour() === true &&
                                item.happyHourPriceUSD && (
                                  <div className="flex items-center gap-2">
                                    <span className="flex select-none items-center gap-2 text-sm font-medium text-muted-foreground">
                                      $ {item.happyHourPriceUSD?.toNumber()}
                                    </span>
                                    <span className="text-sm text-muted-foreground">
                                      *Happy Hour*
                                    </span>
                                  </div>
                                )}
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )
              )}

              {/* GUEST SELECTION GRID */}
              <section className="flex-1 space-y-4 pt-6">
                <div className="flex items-center justify-between space-y-2">
                  <h3 className="text-2xl font-bold tracking-tight">
                    Select Guest for bill
                  </h3>
                </div>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  {guests &&
                    guests
                      .filter(
                        (guest) =>
                          guest.currentReservationId ||
                          guest.type === "OUTSIDE" ||
                          guest.type === "STAFF"
                      )
                      .map((filteredGuest) => {
                        return (
                          <Card
                            onClick={() => {
                              setSelectedCustomer({
                                customer:
                                  filteredGuest.firstName +
                                  " " +
                                  filteredGuest.surname,
                                reservationId:
                                  filteredGuest.currentReservationId ?? "",
                                guestId: filteredGuest.id,
                              });
                              form.setValue(
                                "name",
                                filteredGuest.firstName +
                                  " " +
                                  filteredGuest.surname
                              );
                              form.setValue(
                                "reservationId",
                                filteredGuest.currentReservationId ?? ""
                              );
                              form.setValue("guestId", filteredGuest.id ?? "");
                            }}
                            className="cursor-pointer"
                            key={filteredGuest.id}
                          >
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                              <CardTitle className="flex flex-col">
                                <span className="text-2xl">
                                  {filteredGuest.firstName}
                                </span>
                              </CardTitle>
                            </CardHeader>
                            <CardContent className="flex flex-col gap-y-4">
                              <span>{filteredGuest.type} GUEST</span>
                              {filteredGuest.type === "HOTEL" && (
                                <>
                                  <span className="text-2xl">
                                    Room{" "}
                                    {
                                      filteredGuest.reservations.filter(
                                        (reservation) =>
                                          reservation.status === "CHECKED_IN"
                                      )[0]?.room?.roomNumber
                                    }
                                  </span>
                                  <span className="flex select-none items-center gap-2 text-sm font-medium text-muted-foreground">
                                    Checked in:{" "}
                                    {dayjs(
                                      filteredGuest.reservations.filter(
                                        (reservation) =>
                                          reservation.status === "CHECKED_IN"
                                      )[0]?.checkIn
                                    ).format("DD/MM/YYYY")}
                                  </span>
                                </>
                              )}
                            </CardContent>
                          </Card>
                        );
                      })}
                </div>
              </section>

              <div>
                <span className="text-xl font-bold">Or</span>
              </div>

              <section className="flex flex-col gap-8 md:flex-row">
                {/* CUSTOMER DETAILS FORM */}
                <Form {...form}>
                  <form
                    onSubmit={form.handleSubmit(onSubmit)}
                    className="w-2/3 space-y-6"
                  >
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xl font-bold">
                            Enter name
                          </FormLabel>
                          <FormControl>
                            <Input
                              type="text"
                              {...field}
                              defaultValue={
                                selectedCustomer?.customer ?? field.value
                              }
                              disabled={
                                selectedCustomer?.customer === field.value &&
                                field.value !== undefined
                              }
                              placeholder="Enter customer name"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="guestId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xl font-bold">
                            Guest ID
                          </FormLabel>
                          <FormControl>
                            <Input type="text" {...field} readOnly disabled />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="reservationId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xl font-bold">
                            Reservation ID
                          </FormLabel>
                          <FormControl>
                            <Input type="text" {...field} readOnly disabled />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="flex gap-2">
                      <Button type="submit">Submit</Button>
                      <Button
                        variant="destructive"
                        onClick={() => {
                          setSelectedItems([]);
                          setSelectedCustomer({
                            customer: "",
                            reservationId: "",
                            guestId: "",
                          });
                          form.reset();
                        }}
                        type="reset"
                      >
                        Clear Order
                      </Button>
                    </div>
                  </form>
                </Form>

                {/* ORDER SUMMARY */}
                <section>
                  <div className="flex items-center justify-between space-y-2">
                    <h3 className="text-xl font-bold tracking-tight">Items</h3>
                  </div>

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[100px]">Item</TableHead>
                        <TableHead>Quantity</TableHead>
                        <TableHead>Price USD</TableHead>
                        <TableHead>Total USD</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedItems.map((item) => (
                        <TableRow key={item.itemId}>
                          <TableCell className="font-medium">
                            {item.itemName}
                          </TableCell>
                          <TableCell>x {item.quantity}</TableCell>
                          <TableCell>
                            $
                            {isHappyHour()
                              ? item.happyHourPriceUSD.toString()
                              : item.priceUSD.toString()}
                          </TableCell>
                          <TableCell className="text-right">
                            $
                            {isHappyHour()
                              ? Number(item.happyHourPriceUSD) * item.quantity
                              : Number(item.priceUSD) * item.quantity}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </section>
              </section>
            </TabsContent>

            <TabsContent value="open-orders" className="space-y-4">
              <OrdersTable />
            </TabsContent>
          </Tabs>
        </main>
      )}
    </AdminLayout>
  );
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const { userId } = getAuth(ctx.req);
  const ssg = generateSSGHelper(userId ?? "");

  await ssg.pos.getItems.prefetch();

  return {
    props: {
      ...buildClerkProps(ctx.req),
      trcpState: ssg.dehydrate(),
    },
  };
};
