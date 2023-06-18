import { api } from "@/utils/api";
import DataTable from "./DataTable";
import { Reservation, Prisma, ReservationStatus } from "@prisma/client";
import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "./ui/badge";
import Link from "next/link";
import { Button } from "./ui/button";
import { ArrowUpDown } from "lucide-react";
import { MoreHorizontal } from "lucide-react";
import { convertToNormalCase } from "@/lib/utils";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LoadingPage } from "./loading";
import dayjs from "dayjs";
import { format } from "date-fns";

export const columns: ColumnDef<Reservation>[] = [
  {
    accessorKey: "id",
    header: () => <div className="">Reservation ID</div>,
    cell: ({ row }) => {
      const reservationID: string = row.getValue("id");
      return (
        <Link
          href={`/admin/reservations/${reservationID}`}
          className="w-10 uppercase underline"
        >
          {reservationID}
        </Link>
      );
    },
  },

  {
    accessorKey: "checkIn",
    cell: ({ row }) => {
      return <div>{dayjs(row.getValue("checkIn")).format("ddd MMM YY")}</div>;
    },
    header: ({ column }) => {
      return (
        <Button
          variant="ghost"
          className="px-0"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Check-In
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      );
    },
  },
  {
    accessorKey: "checkOut",
    cell: ({ row }) => {
      return <div>{dayjs(row.getValue("checkOut")).format("ddd MMM YY")}</div>;
    },
    header: ({ column }) => {
      return (
        <Button
          variant="ghost"
          className="px-0"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Check-Out
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      );
    },
  },
  {
    accessorKey: "customerName",
    header: "Name",
  },
  {
    accessorKey: "customerEmail",
    header: "Email",
  },
  {
    accessorKey: "roomType",
    header: "Room Type",
  },
  {
    accessorKey: "status",
    header: ({ column }) => {
      return (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Status
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      );
    },
    cell: ({ row }) => {
      const status: string = row.getValue("status");
      return (
        <Badge
          className="ml-4 uppercase"
          variant={
            status === "CONFIRMED"
              ? "default"
              : status === "FINAL_BILL"
              ? "destructive"
              : "secondary"
          }
        >
          {convertToNormalCase(status)}
        </Badge>
      );
    },
  },
  {
    id: "actions",
    cell: ({ row }) => {
      const order = row.original;
      const status = row.getValue("status");
      const id: string = row.getValue("id");

      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 w-8 p-0">
              <span className="sr-only">Open menu</span>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {status == "CONFIRMED" && (
              <DropdownMenuItem>
                <Link href={`/check-in/${id}`}>Check In Guest</Link>
              </DropdownMenuItem>
            )}
            {status !== "CONFIRMED" && (
              <DropdownMenuItem>
                <Link href={`/check-out/${id}`}>Check Out</Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem>View Order Details</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  },
];

export function ReservationsTable() {
  const {
    data: reservations,
    isError,
    isLoading,
  } = api.reservations.getActiveReservations.useQuery();

  if (isLoading) return <LoadingPage />;
  if (!reservations) return null;

  return <DataTable data={reservations} columns={columns} />;
}