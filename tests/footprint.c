#include <libproc.h>
#include <sys/resource.h>
#include <stdio.h>
#include <stdlib.h>
int main(int argc, char **argv) {
  for (int i=1; i<argc; i++) {
    struct rusage_info_v2 info;
    int pid=atoi(argv[i]);
    if (proc_pid_rusage(pid,RUSAGE_INFO_V2,(rusage_info_t *)&info)!=0) return 1;
    printf("%d %llu\n",pid,(unsigned long long)info.ri_phys_footprint);
  }
  return 0;
}
