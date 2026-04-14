"use client";

import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Users,
  BookOpen,
  Radio,
  MessageSquare,
  MessageCircle,
  UserCheck,
  RefreshCw,
} from "lucide-react";
import DeleteConfirmModal from "./components/DeleteConfirmModal";

import UsersTable from "./components/UsersTable";
import CoursesTable from "./components/CoursesTable";
import SessionsTable from "./components/SessionsTable";
import QuestionsTable from "./components/QuestionsTable";
import EnrollmentsTable from "./components/EnrollmentsTable";
import SlideSetsTable from "./components/SlideSetsTable";

interface Stats {
  users: number;
  courses: number;
  sessions: number;
  activeSessions: number;
  questions: number;
  answers: number;
  enrollments: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");
  const [refreshKey, setRefreshKey] = useState(0);
  const [showSystemDelete, setShowSystemDelete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/stats")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setStats(data);
      })
      .catch(() => null)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const handleRefresh = () => {
    setRefreshKey((k) => k + 1);
  };

  const statCards = [
    { label: "Total Users", value: stats?.users, icon: Users },
    { label: "Total Courses", value: stats?.courses, icon: BookOpen },
    { label: "Active Sessions", value: stats?.activeSessions, icon: Radio },
    { label: "Total Sessions", value: stats?.sessions, icon: Radio },
    { label: "Total Questions", value: stats?.questions, icon: MessageSquare },
    { label: "Total Answers", value: stats?.answers, icon: MessageCircle },
    { label: "Enrollments", value: stats?.enrollments, icon: UserCheck },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-stone-900">Overview</h2>
        <Button variant="outline" size="sm" onClick={handleRefresh}>
          <RefreshCw className="w-4 h-4" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        {statCards.map((card) => (
          <Card key={card.label} className="py-4">
            <CardHeader className="px-4 pb-0 pt-0">
              <div className="flex items-center gap-2 text-stone-500">
                <card.icon className="w-4 h-4" />
                <CardTitle className="text-xs font-medium">{card.label}</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="px-4 pt-1">
              <span className="text-2xl font-bold text-stone-900">
                {loading ? "—" : (card.value ?? 0)}
              </span>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="courses">Courses</TabsTrigger>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="slidesets">Slide Sets</TabsTrigger>
          <TabsTrigger value="questions">Questions</TabsTrigger>
          <TabsTrigger value="enrollments">Enrollments</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Card>
            <CardContent className="pt-6 space-y-4">
              <p className="text-stone-500 text-sm">
                Select a tab above to manage data. Use the Refresh button to reload stats and table
                data.
              </p>
              <div className="p-4 bg-amber-50 rounded-md border border-amber-200">
                <h3 className="text-sm font-semibold text-amber-800 mb-1">
                  Important Note on Deletions
                </h3>
                <p className="text-xs text-amber-700">
                  Deleting a record may cascade to other sections. For example, if you delete a
                  user, it will also delete their answers, questions, and enrollments across the
                  platform. Note that deleting a user only deletes a class if that user is the
                  professor who created it; deleting a student will not delete the class. Deleting a
                  course will delete all of its sessions, enrollments, and questions. Exercise
                  caution when deleting data.
                </p>
              </div>

              <div className="pt-4 border-t">
                <h3 className="text-sm font-semibold text-red-600 mb-2">Danger Zone</h3>
                <div className="flex items-center justify-between p-4 border border-red-200 bg-red-50 rounded-md">
                  <div>
                    <h4 className="text-sm font-medium text-red-900">Delete Everything</h4>
                    <p className="text-xs text-red-700">
                      This action will delete absolutely all data in the database. This cannot be
                      undone.
                    </p>
                  </div>
                  <Button variant="destructive" onClick={() => setShowSystemDelete(true)}>
                    Delete All Data
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="users">
          <UsersTable key={`users-${refreshKey}`} />
        </TabsContent>

        <TabsContent value="courses">
          <CoursesTable key={`courses-${refreshKey}`} />
        </TabsContent>

        <TabsContent value="sessions">
          <SessionsTable key={`sessions-${refreshKey}`} />
        </TabsContent>

        <TabsContent value="slidesets">
          <SlideSetsTable key={`slidesets-${refreshKey}`} />
        </TabsContent>

        <TabsContent value="questions">
          <QuestionsTable key={`questions-${refreshKey}`} />
        </TabsContent>

        <TabsContent value="enrollments">
          <EnrollmentsTable key={`enrollments-${refreshKey}`} />
        </TabsContent>
      </Tabs>

      <DeleteConfirmModal
        isOpen={showSystemDelete}
        onClose={() => setShowSystemDelete(false)}
        title="Delete Entire Database"
        description={
          <>
            This action will permanently delete{" "}
            <strong>
              absolutely ALL users, courses, sessions, questions, enrollments, and answers
            </strong>{" "}
            in the database. This CANNOT be undone.
          </>
        }
        requireTypeToConfirm="DELETE EVERYTHING"
        confirmText="Delete Database"
        onConfirm={async () => {
          const res = await fetch("/api/admin/system/all", { method: "DELETE" });
          if (res.ok) {
            handleRefresh();
          } else {
            alert("Failed to clear database.");
          }
        }}
      />
    </div>
  );
}
