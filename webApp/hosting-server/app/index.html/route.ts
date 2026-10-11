export function GET(request:Request){
  const url=new URL(request.url);
  return new Response(null,{status:307,headers:{Location:'/'+url.search,'Cache-Control':'public, max-age=0, must-revalidate'}});
}
